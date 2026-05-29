import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { DataSource, In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { DueQueryDto } from '@/progress/dto/due-query.dto';
import { EnrollDto, EnrollResponseDto } from '@/progress/dto/enroll.dto';
import {
  DueCardResponseDto,
  ProgressResponseDto,
} from '@/progress/dto/progress-response.dto';
import { ReviewDto } from '@/progress/dto/review.dto';
import {
  ProgressCountsDto,
  StatsResponseDto,
} from '@/progress/dto/stats-response.dto';
import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { applySm2, ReviewQuality } from '@/progress/srs';
import { User } from '@/users/entities/user.entity';
import { VocabularyResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Injectable()
export class ProgressService {
  constructor(
    @InjectRepository(UserWordProgress)
    private readonly progressRepo: Repository<UserWordProgress>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async enroll(userId: string, dto: EnrollDto): Promise<EnrollResponseDto> {
    const requested = await this.resolveVocabularyIds(dto);
    if (requested.length === 0) {
      return { enrolled: 0, alreadyEnrolled: 0, unknownVocabularyIds: [] };
    }

    // Accept system vocab (anyone can enroll) plus the caller's own private vocab.
    const existing = await this.vocabRepo
      .createQueryBuilder('v')
      .select('v.id', 'id')
      .where('v.id IN (:...ids)', { ids: requested })
      .andWhere(
        '(v.source = :system OR (v.source = :user AND v.created_by_user_id = :userId))',
        {
          system: VocabularySource.SYSTEM,
          user: VocabularySource.USER,
          userId,
        },
      )
      .getRawMany<{ id: string }>();
    const knownIds = new Set(existing.map((v) => v.id));
    const unknownVocabularyIds = requested.filter((id) => !knownIds.has(id));
    const knownRequested = requested.filter((id) => knownIds.has(id));

    if (knownRequested.length === 0) {
      return { enrolled: 0, alreadyEnrolled: 0, unknownVocabularyIds };
    }

    const alreadyEnrolledRows = await this.progressRepo.find({
      where: { userId, vocabularyId: In(knownRequested) },
      select: { vocabularyId: true },
    });
    const alreadyEnrolledSet = new Set(
      alreadyEnrolledRows.map((r) => r.vocabularyId),
    );

    const toCreate = knownRequested.filter((id) => !alreadyEnrolledSet.has(id));
    if (toCreate.length > 0) {
      const rows = toCreate.map((vocabularyId) =>
        this.progressRepo.create({
          userId,
          vocabularyId,
          status: ProgressStatus.NEW,
        }),
      );
      await this.progressRepo.save(rows);
    }

    return {
      enrolled: toCreate.length,
      alreadyEnrolled: alreadyEnrolledSet.size,
      unknownVocabularyIds,
    };
  }

  async findDue(
    userId: string,
    query: DueQueryDto,
  ): Promise<DueCardResponseDto[]> {
    const { limit, translationLang } = query;
    const now = new Date();

    const dueRows = await this.progressRepo.find({
      where: { userId, nextReviewAt: LessThanOrEqual(now) },
      order: { nextReviewAt: 'ASC' },
      take: limit,
    });
    if (dueRows.length === 0) return [];

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

    return dueRows.map((progress) => {
      const vocab = vocabById.get(progress.vocabularyId);
      const vocabularyDto = vocab
        ? plainToInstance(VocabularyResponseDto, vocab, {
            excludeExtraneousValues: true,
          })
        : (undefined as unknown as VocabularyResponseDto);
      const base = plainToInstance(DueCardResponseDto, progress, {
        excludeExtraneousValues: true,
      });
      base.vocabulary = vocabularyDto;
      return base;
    });
  }

  async submitReview(
    userId: string,
    dto: ReviewDto,
  ): Promise<ProgressResponseDto> {
    const progress = await this.progressRepo.findOne({
      where: { userId, vocabularyId: dto.vocabularyId },
    });
    if (!progress) {
      throw new NotFoundException(
        'not enrolled — call /v1/me/progress/enroll first',
      );
    }

    const now = new Date();
    const next = applySm2(
      {
        status: progress.status,
        repetitions: progress.repetitions,
        easeFactor: Number(progress.easeFactor),
        intervalDays: progress.intervalDays,
      },
      dto.quality as ReviewQuality,
      now,
    );

    progress.status = next.status;
    progress.repetitions = next.repetitions;
    progress.easeFactor = next.easeFactor;
    progress.intervalDays = next.intervalDays;
    progress.nextReviewAt = next.nextReviewAt;
    progress.lastReviewedAt = now;
    if (dto.quality >= 3) progress.correctCount += 1;
    else progress.incorrectCount += 1;

    await this.progressRepo.save(progress);
    return plainToInstance(ProgressResponseDto, progress, {
      excludeExtraneousValues: true,
    });
  }

  async getStats(userId: string): Promise<StatsResponseDto> {
    const user = await this.userRepo.findOne({
      where: { id: userId },
      select: { id: true, dailyGoalMinutes: true },
    });
    if (!user) {
      throw new NotFoundException('user not found');
    }

    const now = new Date();
    const counts = await this.computeCounts(userId);
    const dueNow = await this.progressRepo.count({
      where: { userId, nextReviewAt: LessThanOrEqual(now) },
    });
    const reviewedToday = await this.countReviewedToday(userId);
    const streakDays = await this.computeStreak(userId);
    const nextDueAt = await this.findNextDueAt(userId, now);

    return {
      streakDays,
      dueNow,
      reviewedToday,
      dailyGoalMinutes: user.dailyGoalMinutes,
      counts,
      nextDueAt: nextDueAt ? nextDueAt.toISOString() : null,
    };
  }

  // Earliest `next_review_at` strictly in the future for this user.
  // Returns null when nothing is enrolled or every card is already due.
  async findNextDueAt(
    userId: string,
    now: Date = new Date(),
  ): Promise<Date | null> {
    const row = await this.progressRepo.findOne({
      where: { userId, nextReviewAt: MoreThan(now) },
      order: { nextReviewAt: 'ASC' },
      select: { nextReviewAt: true },
    });
    return row?.nextReviewAt ?? null;
  }

  private async resolveVocabularyIds(dto: EnrollDto): Promise<string[]> {
    if (dto.vocabularyIds && dto.vocabularyIds.length > 0) {
      return Array.from(new Set(dto.vocabularyIds));
    }
    if (dto.deckId) {
      const rows = await this.dataSource.getRepository(DeckVocabulary).find({
        where: { deckId: dto.deckId },
        select: { vocabularyId: true },
      });
      if (rows.length === 0) {
        throw new BadRequestException(
          'deck has no vocabularies or does not exist',
        );
      }
      return rows.map((r) => r.vocabularyId);
    }
    throw new BadRequestException(
      'enroll requires either vocabularyIds or deckId',
    );
  }

  private async computeCounts(userId: string): Promise<ProgressCountsDto> {
    const rows = await this.progressRepo
      .createQueryBuilder('p')
      .select('p.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .where('p.user_id = :userId', { userId })
      .groupBy('p.status')
      .getRawMany<{ status: ProgressStatus; count: number }>();

    const counts: ProgressCountsDto = {
      new: 0,
      learning: 0,
      review: 0,
      mastered: 0,
    };
    for (const r of rows) counts[r.status] = r.count;
    return counts;
  }

  private async countReviewedToday(userId: string): Promise<number> {
    const result = await this.progressRepo.manager.query<{ count: string }[]>(
      `SELECT COUNT(*)::int AS count
       FROM user_word_progress
       WHERE user_id = $1
         AND last_reviewed_at IS NOT NULL
         AND (last_reviewed_at AT TIME ZONE 'UTC')::date = (now() AT TIME ZONE 'UTC')::date`,
      [userId],
    );
    return Number(result[0]?.count ?? 0);
  }

  // Streak = consecutive UTC days with at least one review, ending at the
  // most recent review date. Counts only if that date is today or yesterday
  // (otherwise the streak has been broken).
  private async computeStreak(userId: string): Promise<number> {
    const rows = await this.progressRepo.manager.query<{ d: string }[]>(
      `SELECT DISTINCT (last_reviewed_at AT TIME ZONE 'UTC')::date::text AS d
       FROM user_word_progress
       WHERE user_id = $1 AND last_reviewed_at IS NOT NULL
       ORDER BY d DESC`,
      [userId],
    );
    if (rows.length === 0) return 0;

    const datesDesc = rows.map((r) => r.d);
    const today = new Date();
    const todayStr = toUtcDateString(today);
    const yesterdayStr = toUtcDateString(
      new Date(today.getTime() - 86_400_000),
    );

    if (datesDesc[0] !== todayStr && datesDesc[0] !== yesterdayStr) {
      return 0;
    }

    let streak = 0;
    let cursor = datesDesc[0];
    for (const d of datesDesc) {
      if (d !== cursor) break;
      streak += 1;
      const prev = new Date(`${cursor}T00:00:00Z`);
      prev.setUTCDate(prev.getUTCDate() - 1);
      cursor = toUtcDateString(prev);
    }
    return streak;
  }
}

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}
