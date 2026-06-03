import { randomUUID } from 'crypto';
import {
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import learnConfig from '@/config/learn.config';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { AnswerGraderService } from '@/learn/answer-grader.service';
import {
  AnswerResultDto,
  RequeuedItemDto,
} from '@/learn/dto/answer-result.dto';
import { CreateSessionDto } from '@/learn/dto/create-session.dto';
import {
  CreateSessionResponseDto,
  SessionEmptyReason,
  SessionItemDto,
} from '@/learn/dto/session-item.dto';
import { SubmitAnswerDto } from '@/learn/dto/submit-answer.dto';
import { LearnSessionMode } from '@/learn/enums/learn-session-mode.enum';
import { HmacSignerService } from '@/learn/hmac-signer.service';
import {
  BuiltQuestion,
  QuestionBuilderService,
} from '@/learn/question-builder.service';
import { PickResult, VocabPickerService } from '@/learn/vocab-picker.service';
import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { ProgressService } from '@/progress/progress.service';
import { User } from '@/users/entities/user.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Injectable()
export class LearnService {
  constructor(
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(UserWordProgress)
    private readonly progressRepo: Repository<UserWordProgress>,
    private readonly picker: VocabPickerService,
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

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('user not found');
    }

    // 1) Pick vocab IDs for this mode
    const picked = await this.dispatchPicker(user, dto, limit);

    // 2) Auto-enroll fresh picks (review mode never has fresh)
    let enrolledNewlyCount = 0;
    if (picked.freshVocabIds.length > 0) {
      const result = await this.progressService.enroll(userId, {
        vocabularyIds: picked.freshVocabIds,
      });
      enrolledNewlyCount = result.enrolled;
    }

    // 3) If nothing to learn, surface the picker's empty reason
    const allVocabIds = [...picked.dueVocabIds, ...picked.freshVocabIds];
    if (allVocabIds.length === 0) {
      const reason: SessionEmptyReason = picked.emptyReason ?? 'no_due_cards';
      return {
        sessionId: randomUUID(),
        mode: dto.mode,
        enrolledNewlyCount,
        emptyReason: reason,
        nextDueAt: await this.resolveNextDueAt(userId, reason),
        items: [],
      };
    }

    // 4) Load vocab tree (senses + examples + translations) + progress rows
    //    for the per-word mastery stage in a single batch (avoids N+1).
    const [vocabs, progressRows] = await Promise.all([
      this.loadVocabTree(allVocabIds, translationLang),
      this.progressRepo.find({
        where: { userId, vocabularyId: In(allVocabIds) },
        select: { vocabularyId: true, status: true },
      }),
    ]);
    const vocabById = new Map(vocabs.map((v) => [v.id, v]));
    const statusByVocabId = new Map(
      progressRows.map((p) => [p.vocabularyId, p.status]),
    );

    // 5) Expand each word into its lesson ladder (easy→hard for its stage),
    //    grouped and signed, in pick order.
    const items: SessionItemDto[] = [];
    for (const vocabId of allVocabIds) {
      const vocab = vocabById.get(vocabId);
      if (!vocab) continue;

      const status = statusByVocabId.get(vocabId) ?? ProgressStatus.NEW;
      const built = await this.questionBuilder.buildLadder({
        vocab,
        status,
        translationLang,
      });
      if (built.length === 0) continue;

      items.push(
        ...this.assembleLessonItems({ userId, vocab, built, translationLang }),
      );
    }

    const emptyReason: SessionEmptyReason | null =
      items.length === 0 ? (picked.emptyReason ?? 'no_due_cards') : null;

    return {
      sessionId: randomUUID(),
      mode: dto.mode,
      enrolledNewlyCount,
      emptyReason,
      nextDueAt: emptyReason
        ? await this.resolveNextDueAt(userId, emptyReason)
        : null,
      items,
    };
  }

  // Only `no_due_cards` is a time-based empty reason — for the others
  // ("no_more_at_level", "no_enrollment", "deck_exhausted") the user isn't
  // waiting on the clock, so don't claim there's a next time.
  private async resolveNextDueAt(
    userId: string,
    reason: SessionEmptyReason,
  ): Promise<string | null> {
    if (reason !== 'no_due_cards') return null;
    const next = await this.progressService.findNextDueAt(userId);
    return next ? next.toISOString() : null;
  }

  async submitAnswer(
    userId: string,
    dto: SubmitAnswerDto,
  ): Promise<AnswerResultDto> {
    const translationLang = dto.translationLang ?? null;
    this.signer.verify(
      {
        userId,
        vocabularyId: dto.vocabularyId,
        type: dto.type,
        exampleId: dto.exampleId,
        translationLang,
        stepIndex: dto.stepIndex,
        stepCount: dto.stepCount,
        nonce: dto.nonce,
        issuedAtMs: dto.issuedAtMs,
      },
      dto.signature,
    );

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
      throw new UnauthorizedException('invalid example for vocabulary');
    }

    const result = this.grader.grade({
      type: dto.type,
      vocab,
      example: example.example,
      sense: example.sense,
      translationLang,
      userAnswer: dto.userAnswer,
      latencyMs: dto.latencyMs,
    });

    // A word's lesson is one SRS event: only the final step (the hardest
    // question) reschedules. Earlier steps grade for immediate feedback but
    // leave the schedule untouched, so a multi-question lesson can't graduate
    // the card in a single sitting.
    const isFinalStep = dto.stepIndex === dto.stepCount - 1;
    if (!isFinalStep) {
      return {
        correct: result.correct,
        correctAnswer: result.correctAnswer,
        quality: result.quality,
        progress: null,
        requeue: null,
      };
    }

    const progress = await this.progressService.submitReview(userId, {
      vocabularyId: dto.vocabularyId,
      quality: result.quality,
    });

    return {
      correct: result.correct,
      correctAnswer: result.correctAnswer,
      quality: result.quality,
      progress,
      requeue: await this.buildRequeue({
        userId,
        vocab,
        status: progress.status,
        nextReviewAt: progress.nextReviewAt,
        translationLang,
      }),
    };
  }

  // If the SRS just rescheduled the card within the requeue window, bake the
  // word's next lesson ladder (for its now-advanced stage) so the client can
  // re-surface it in the same session without polling /session.
  private async buildRequeue(args: {
    userId: string;
    vocab: Vocabulary;
    status: ProgressStatus;
    nextReviewAt: Date;
    translationLang: string | null;
  }): Promise<RequeuedItemDto | null> {
    const windowMs = this.cfg.requeueWindowMinutes * 60_000;
    const dueAtMs = args.nextReviewAt.getTime();
    if (dueAtMs - Date.now() > windowMs) return null;

    const built = await this.questionBuilder.buildLadder({
      vocab: args.vocab,
      status: args.status,
      translationLang: args.translationLang,
    });
    if (built.length === 0) return null;

    const items = this.assembleLessonItems({
      userId: args.userId,
      vocab: args.vocab,
      built,
      translationLang: args.translationLang,
    });
    return { dueAtMs, items };
  }

  // ------------------- internals -------------------

  // Turns a word's built ladder into signed, grouped session items. All
  // steps of one word share a `groupId`; each carries its `stepIndex` /
  // `stepCount` (both signed) so the client can render lesson progress and
  // the server can tell which step is SRS-bearing on submit.
  private assembleLessonItems(args: {
    userId: string;
    vocab: Vocabulary;
    built: BuiltQuestion[];
    translationLang: string | null;
  }): SessionItemDto[] {
    const { userId, vocab, built, translationLang } = args;
    const groupId = randomUUID();
    const stepCount = built.length;
    return built.map((b, stepIndex) => {
      const issued = this.signer.issue({
        userId,
        vocabularyId: vocab.id,
        type: b.type,
        exampleId: b.exampleId,
        translationLang,
        stepIndex,
        stepCount,
      });
      return {
        sessionItemId: randomUUID(),
        groupId,
        stepIndex,
        stepCount,
        vocabularyId: vocab.id,
        lemma: vocab.lemma,
        exampleId: b.exampleId,
        type: b.type,
        nonce: issued.nonce,
        issuedAtMs: issued.issuedAtMs,
        signature: issued.signature,
        prompt: b.prompt,
      };
    });
  }

  private dispatchPicker(
    user: User,
    dto: CreateSessionDto,
    limit: number,
  ): Promise<PickResult> {
    switch (dto.mode) {
      case LearnSessionMode.DAILY:
        return this.picker.pickDaily(user, limit);
      case LearnSessionMode.TOPIC:
        return this.picker.pickByTopic(user, dto.topicSlug!, limit);
      case LearnSessionMode.DECK:
        return this.picker.pickByDeck(user, dto.deckId!, limit);
      case LearnSessionMode.REVIEW:
        return this.picker.pickReview(user, limit);
    }
  }

  private async loadVocabTree(
    vocabIds: string[],
    translationLang: string | null,
  ): Promise<Vocabulary[]> {
    const qb = this.vocabRepo
      .createQueryBuilder('vocab')
      .whereInIds(vocabIds)
      .leftJoinAndSelect('vocab.senses', 'senses')
      .leftJoinAndSelect('senses.examples', 'examples');
    if (translationLang) {
      qb.leftJoinAndSelect(
        'senses.translations',
        'translations',
        'translations.language = :translationLang',
        { translationLang },
      );
    } else {
      qb.leftJoinAndSelect('senses.translations', 'translations');
    }
    return qb.addOrderBy('senses.sense_order', 'ASC').getMany();
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
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
