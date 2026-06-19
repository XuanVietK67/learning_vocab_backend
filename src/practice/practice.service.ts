import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, MoreThanOrEqual, Repository } from 'typeorm';
import { VocabPickerService } from '@/learn/vocab-picker.service';
import {
  AttemptAcceptedDto,
  AttemptResultDto,
} from '@/practice/dto/attempt-response.dto';
import {
  PracticeItemDto,
  PracticeSetResponseDto,
  PracticeSuggestionsResponseDto,
} from '@/practice/dto/practice-item.dto';
import { PracticeSetDto } from '@/practice/dto/practice-set.dto';
import { PracticeSuggestionsQueryDto } from '@/practice/dto/practice-suggestions-query.dto';
import { SubmitAttemptDto } from '@/practice/dto/submit-attempt.dto';
import { ProductionAttempt } from '@/practice/entities/production-attempt.entity';
import { ScoringStatus } from '@/practice/entities/scoring-status.enum';
import { ScoringQueueProducer } from '@/practice/scoring-queue.producer';
import { User } from '@/users/entities/user.entity';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Injectable()
export class PracticeService {
  private readonly logger = new Logger(PracticeService.name);

  constructor(
    @InjectRepository(ProductionAttempt)
    private readonly attemptRepo: Repository<ProductionAttempt>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly producer: ScoringQueueProducer,
    private readonly picker: VocabPickerService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Build a ready-to-practise word list without the user having to search.
   * Reuses the SRS picker (due + level-appropriate fresh words); if that runs
   * short, tops up with random level-matched words so practice is never a dead
   * end. Read-only — unlike a learn session it does NOT auto-enrol fresh words,
   * so picking words to practise never starts an SRS schedule.
   */
  async getSuggestions(
    userId: string,
    query: PracticeSuggestionsQueryDto,
  ): Promise<PracticeSuggestionsResponseDto> {
    const count = query.count ?? 10;

    const user = await this.userRepo.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('user not found');

    // Throws 400 if the user hasn't onboarded (needs targetLanguage + level).
    const picked = await this.picker.pickDaily(user, count);
    const ids = [...picked.dueVocabIds, ...picked.freshVocabIds];

    let usedFallback = false;
    if (ids.length < count) {
      const fallback = await this.findRandomFallbackIds(
        user,
        count - ids.length,
        ids,
      );
      if (fallback.length > 0) {
        ids.push(...fallback);
        usedFallback = true;
      }
    }

    return { items: await this.hydrateItems(ids), usedFallback };
  }

  /**
   * Validate and hydrate an explicit list of words the user ticked. Keeps the
   * caller's order; IDs that don't exist or aren't practiceable (another user's
   * private word, or an unapproved system draft) are returned under
   * `inaccessibleVocabularyIds` rather than silently dropped.
   */
  async buildSet(
    userId: string,
    dto: PracticeSetDto,
  ): Promise<PracticeSetResponseDto> {
    const ids = [...new Set(dto.vocabularyIds)];

    const vocabs = await this.vocabRepo.find({
      where: { id: In(ids) },
      relations: { senses: true },
    });
    const accessible = new Map(
      vocabs
        .filter((v) => this.isPracticeable(v, userId))
        .map((v) => [v.id, v]),
    );

    const items = ids
      .filter((id) => accessible.has(id))
      .map((id) => toPracticeItem(accessible.get(id)!));
    const inaccessibleVocabularyIds = ids.filter((id) => !accessible.has(id));

    return { items, inaccessibleVocabularyIds };
  }

  // A word is practiceable if it's an approved system word or the user's own.
  private isPracticeable(vocab: Vocabulary, userId: string): boolean {
    if (vocab.source === VocabularySource.SYSTEM) return vocab.isApproved;
    return vocab.createdByUserId === userId;
  }

  // Random approved system words in the user's target language, preferring
  // their CEFR level, excluding anything already picked. Unlike the picker's
  // "fresh" query this does NOT skip words the user has progress on — a learner
  // who has studied everything at their level can still re-practise them.
  private async findRandomFallbackIds(
    user: User,
    need: number,
    excludeIds: string[],
  ): Promise<string[]> {
    const qb = this.vocabRepo
      .createQueryBuilder('v')
      .select('v.id', 'id')
      .where('v.source = :system', { system: VocabularySource.SYSTEM })
      .andWhere('v.is_approved = true')
      .andWhere('v.language = :lang', { lang: user.targetLanguage });

    if (excludeIds.length > 0) {
      qb.andWhere('v.id NOT IN (:...excludeIds)', { excludeIds });
    }

    // Level-matched words first (randomised within), then the rest at random,
    // so the list is never empty even when the user's CEFR band is exhausted.
    qb.setParameter('level', user.proficiencyLevel)
      .orderBy('CASE WHEN v.cefr_level = :level THEN 0 ELSE 1 END', 'ASC')
      .addOrderBy('RANDOM()')
      .limit(need);

    const rows = await qb.getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  // Load the given vocab IDs (with senses) and map to PracticeItemDto,
  // preserving the input order.
  private async hydrateItems(ids: string[]): Promise<PracticeItemDto[]> {
    if (ids.length === 0) return [];
    const vocabs = await this.vocabRepo.find({
      where: { id: In(ids) },
      relations: { senses: true },
    });
    const byId = new Map(vocabs.map((v) => [v.id, v]));
    return ids
      .map((id) => byId.get(id))
      .filter((v): v is Vocabulary => v !== undefined)
      .map(toPracticeItem);
  }

  /**
   * Create a pending attempt and enqueue it for async scoring. Enforces a
   * per-user daily cap first (the Gemma free tier is one shared key). If the
   * queue is unreachable the row is rolled back and a 503 is returned, so an
   * attempt is never orphaned in `pending`.
   */
  async submit(
    userId: string,
    dto: SubmitAttemptDto,
  ): Promise<AttemptAcceptedDto> {
    const vocab = await this.vocabRepo.findOne({
      where: { id: dto.vocabularyId },
      select: { id: true },
    });
    if (!vocab) throw new NotFoundException('vocabulary not found');

    await this.assertUnderDailyCap(userId);

    const attempt = await this.attemptRepo.save(
      this.attemptRepo.create({
        userId,
        vocabularyId: dto.vocabularyId,
        modality: dto.modality,
        submittedText: dto.text.trim(),
        status: ScoringStatus.PENDING,
      }),
    );

    try {
      await this.producer.enqueue(attempt.id);
    } catch (err) {
      // Roll back so the row isn't stuck pending and doesn't burn the quota.
      await this.attemptRepo.delete({ id: attempt.id });
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`failed to enqueue scoring for ${attempt.id}: ${msg}`);
      throw new ServiceUnavailableException('scoring queue unavailable');
    }

    return { attemptId: attempt.id, status: attempt.status };
  }

  /** Fetch one attempt owned by the user. */
  async getResult(
    userId: string,
    attemptId: string,
  ): Promise<AttemptResultDto> {
    const attempt = await this.attemptRepo.findOne({
      where: { id: attemptId, userId },
    });
    if (!attempt) throw new NotFoundException('attempt not found');
    return toResultDto(attempt);
  }

  private async assertUnderDailyCap(userId: string): Promise<void> {
    const cap = this.config.get<number>('gemma.dailyAttemptsPerUser', 30);
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const usedToday = await this.attemptRepo.count({
      where: { userId, createdAt: MoreThanOrEqual(startOfDay) },
    });
    if (usedToday >= cap) {
      throw new HttpException(
        `daily practice limit reached (${cap}/day)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

// Map a vocabulary (with its senses loaded) to the lean practice-prompt shape.
// Glosses prefer `gloss`, fall back to `definition`, ordered by sense_order,
// capped at 5 — the same source the judge uses for the word's intended meaning.
function toPracticeItem(v: Vocabulary): PracticeItemDto {
  const glosses = (v.senses ?? [])
    .slice()
    .sort((a, b) => a.senseOrder - b.senseOrder)
    .map((s) => s.gloss ?? s.definition)
    .filter((g): g is string => Boolean(g && g.trim()))
    .slice(0, 5);
  return {
    vocabularyId: v.id,
    lemma: v.lemma,
    partOfSpeech: v.partOfSpeech,
    ipa: v.ipa,
    audioUrl: v.audioUrl,
    glosses,
  };
}

function toResultDto(a: ProductionAttempt): AttemptResultDto {
  return {
    id: a.id,
    vocabularyId: a.vocabularyId,
    modality: a.modality,
    text: a.submittedText,
    status: a.status,
    score: a.score,
    cefr: a.cefr,
    rubric: a.rubric,
    feedback: a.feedback,
    error: a.error,
    createdAt: a.createdAt.toISOString(),
    scoredAt: a.scoredAt ? a.scoredAt.toISOString() : null,
  };
}
