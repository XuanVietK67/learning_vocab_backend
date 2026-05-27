import { randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import learnConfig from '@/config/learn.config';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { AnswerGraderService } from '@/learn/answer-grader.service';
import { AnswerResultDto } from '@/learn/dto/answer-result.dto';
import { CreateSessionDto } from '@/learn/dto/create-session.dto';
import {
  CreateSessionResponseDto,
  SessionItemDto,
} from '@/learn/dto/session-item.dto';
import { SubmitAnswerDto } from '@/learn/dto/submit-answer.dto';
import { HmacSignerService } from '@/learn/hmac-signer.service';
import { QuestionBuilderService } from '@/learn/question-builder.service';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { ProgressService } from '@/progress/progress.service';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Injectable()
export class LearnService {
  constructor(
    @InjectRepository(UserWordProgress)
    private readonly progressRepo: Repository<UserWordProgress>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    @InjectRepository(DeckVocabulary)
    private readonly deckVocabRepo: Repository<DeckVocabulary>,
    private readonly questionBuilder: QuestionBuilderService,
    private readonly grader: AnswerGraderService,
    private readonly signer: HmacSignerService,
    private readonly progressService: ProgressService,
    @Inject(learnConfig.KEY)
    private readonly cfg: ConfigType<typeof learnConfig>,
  ) {}

  async createSession(
    userId: string,
    dto: CreateSessionDto,
  ): Promise<CreateSessionResponseDto> {
    const limit = clamp(
      dto.limit ?? this.cfg.defaultSessionLimit,
      1,
      this.cfg.maxSessionLimit,
    );
    const translationLang = dto.translationLang ?? null;

    // Fetch due cards (optionally restricted to a deck)
    const dueQb = this.progressRepo
      .createQueryBuilder('p')
      .where('p.user_id = :userId', { userId })
      .andWhere('p.next_review_at <= :now', { now: new Date() })
      .orderBy('p.next_review_at', 'ASC')
      .limit(limit);

    if (dto.deckId) {
      dueQb.andWhere(
        `EXISTS (
          SELECT 1 FROM deck_vocabularies dv
          WHERE dv.deck_id = :deckId AND dv.vocabulary_id = p.vocabulary_id
        )`,
        { deckId: dto.deckId },
      );
    }

    const dueRows = await dueQb.getMany();
    if (dueRows.length === 0) {
      return { sessionId: randomUUID(), items: [] };
    }

    const vocabIds = dueRows.map((r) => r.vocabularyId);
    const vocabQb = this.vocabRepo
      .createQueryBuilder('vocab')
      .whereInIds(vocabIds)
      .leftJoinAndSelect('vocab.senses', 'senses')
      .leftJoinAndSelect('senses.examples', 'examples');
    if (translationLang) {
      vocabQb.leftJoinAndSelect(
        'senses.translations',
        'translations',
        'translations.language = :translationLang',
        { translationLang },
      );
    } else {
      vocabQb.leftJoinAndSelect('senses.translations', 'translations');
    }
    const vocabs = await vocabQb
      .addOrderBy('senses.sense_order', 'ASC')
      .getMany();
    const vocabById = new Map(vocabs.map((v) => [v.id, v]));

    const daySeed = toUtcDateString(new Date());
    const items: SessionItemDto[] = [];
    for (const progress of dueRows) {
      const vocab = vocabById.get(progress.vocabularyId);
      if (!vocab) continue;

      const built = await this.questionBuilder.build({
        vocab,
        status: progress.status,
        translationLang,
        daySeed,
      });
      if (!built) continue;

      const issued = this.signer.issue({
        userId,
        vocabularyId: vocab.id,
        type: built.type,
        exampleId: built.exampleId,
        translationLang,
      });
      items.push({
        sessionItemId: randomUUID(),
        vocabularyId: vocab.id,
        lemma: vocab.lemma,
        exampleId: built.exampleId,
        type: built.type,
        nonce: issued.nonce,
        issuedAtMs: issued.issuedAtMs,
        signature: issued.signature,
        prompt: built.prompt,
      });
    }

    return { sessionId: randomUUID(), items };
  }

  async submitAnswer(
    userId: string,
    dto: SubmitAnswerDto,
  ): Promise<AnswerResultDto> {
    const translationLang = dto.translationLang ?? null;
    // 1) HMAC verify (throws UnauthorizedException on tamper/expiry)
    this.signer.verify(
      {
        userId,
        vocabularyId: dto.vocabularyId,
        type: dto.type,
        exampleId: dto.exampleId,
        translationLang,
        nonce: dto.nonce,
        issuedAtMs: dto.issuedAtMs,
      },
      dto.signature,
    );

    // 2) Load vocab with senses/examples/translations for grading
    const vocab = await this.vocabRepo
      .createQueryBuilder('vocab')
      .where('vocab.id = :id', { id: dto.vocabularyId })
      .leftJoinAndSelect('vocab.senses', 'senses')
      .leftJoinAndSelect('senses.examples', 'examples')
      .leftJoinAndSelect('senses.translations', 'translations')
      .orderBy('senses.sense_order', 'ASC')
      .getOne();
    if (!vocab) {
      throw new NotFoundException('vocabulary not found');
    }
    const example = findExample(vocab, dto.exampleId);
    if (!example.example) {
      // exampleId belongs to a different vocab — treat as tamper attempt
      throw new UnauthorizedException('invalid example for vocabulary');
    }

    // 3) Grade
    const result = this.grader.grade({
      type: dto.type,
      vocab,
      example: example.example,
      sense: example.sense,
      translationLang,
      userAnswer: dto.userAnswer,
      latencyMs: dto.latencyMs,
    });

    // 4) Feed SM-2 via existing ProgressService.submitReview
    const progress = await this.progressService.submitReview(userId, {
      vocabularyId: dto.vocabularyId,
      quality: result.quality,
    });

    return {
      correct: result.correct,
      correctAnswer: result.correctAnswer,
      quality: result.quality,
      progress,
    };
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function findExample(
  vocab: Vocabulary,
  exampleId: string,
):
  | { sense: Vocabulary['senses'][number]; example: undefined }
  | {
      sense: Vocabulary['senses'][number];
      example: Vocabulary['senses'][number]['examples'][number];
    } {
  for (const sense of vocab.senses ?? []) {
    const ex = (sense.examples ?? []).find((e) => e.id === exampleId);
    if (ex) return { sense, example: ex };
  }
  const fallbackSense = (vocab.senses ?? [])[0];
  if (!fallbackSense) {
    throw new NotFoundException('vocabulary has no senses');
  }
  return { sense: fallbackSense, example: undefined };
}
