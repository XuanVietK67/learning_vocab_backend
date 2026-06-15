import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { DataSource, In, LessThanOrEqual, MoreThan, Repository } from 'typeorm';
import learnConfig from '@/config/learn.config';
import { Deck } from '@/decks/entities/deck.entity';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { DueQueryDto } from '@/progress/dto/due-query.dto';
import { EnrollDto, EnrollResponseDto } from '@/progress/dto/enroll.dto';
import {
  DueCardResponseDto,
  ProgressResponseDto,
} from '@/progress/dto/progress-response.dto';
import { ReviewDto } from '@/progress/dto/review.dto';
import { ActivityQueryDto } from '@/progress/dto/activity-query.dto';
import {
  ActivityDayDto,
  ActivityResponseDto,
} from '@/progress/dto/activity-response.dto';
import {
  ProgressCountsDto,
  StatsResponseDto,
} from '@/progress/dto/stats-response.dto';
import { LearningActivity } from '@/progress/entities/learning-activity.entity';
import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { applySm2, ReviewQuality } from '@/progress/srs';
import { User } from '@/users/entities/user.entity';
import { VocabularyResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Visibility } from '@/vocabularies/entities/visibility.enum';
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
    @Inject(learnConfig.KEY)
    private readonly cfg: ConfigType<typeof learnConfig>,
  ) {}

  async enroll(userId: string, dto: EnrollDto): Promise<EnrollResponseDto> {
    // Deck enrollment is authorized by deck membership + deck access, so it
    // takes a separate path that does NOT apply the per-word ownership filter.
    if (dto.deckId) {
      return this.enrollDeckMembers(userId, dto.deckId, dto.vocabularyIds);
    }

    const requested = Array.from(new Set(dto.vocabularyIds ?? []));
    if (requested.length === 0) {
      return { enrolled: 0, alreadyEnrolled: 0, unknownVocabularyIds: [] };
    }

    // Free-form enrollment by id: accept system vocab (anyone can enroll) plus
    // the caller's own private vocab. This filter is a security control — it
    // stops a caller from enrolling in arbitrary private words by id.
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

    return this.persistEnrollment(userId, knownRequested, unknownVocabularyIds);
  }

  // Enroll the members of a deck the caller is entitled to study. Unlike the
  // by-id path, this trusts deck membership rather than vocab ownership: a
  // cloned/community deck's words are still owned by the original author, but
  // the caller is entitled to study every member of a deck they own (or a
  // seeded/public deck). When `restrictTo` is given (e.g. the session
  // auto-enroll passing just the fresh picks), only those members are enrolled.
  private async enrollDeckMembers(
    userId: string,
    deckId: string,
    restrictTo?: string[],
  ): Promise<EnrollResponseDto> {
    await this.assertDeckStudyable(userId, deckId);

    const memberRows = await this.dataSource
      .getRepository(DeckVocabulary)
      .find({
        where: { deckId },
        select: { vocabularyId: true },
      });
    if (memberRows.length === 0) {
      throw new BadRequestException(
        'deck has no vocabularies or does not exist',
      );
    }
    const memberIds = new Set(memberRows.map((r) => r.vocabularyId));

    let enrollableIds: string[];
    let unknownVocabularyIds: string[];
    if (restrictTo && restrictTo.length > 0) {
      const requested = Array.from(new Set(restrictTo));
      // Anything requested that isn't actually in the deck is unknown — never
      // enroll it, since deck membership is the only authorization here.
      enrollableIds = requested.filter((id) => memberIds.has(id));
      unknownVocabularyIds = requested.filter((id) => !memberIds.has(id));
    } else {
      enrollableIds = Array.from(memberIds);
      unknownVocabularyIds = [];
    }

    return this.persistEnrollment(userId, enrollableIds, unknownVocabularyIds);
  }

  // A deck is studyable by the caller when they own it, it's a seeded
  // (owner-less) deck, or it's a user deck published `public`. Mirrors the
  // visibility rules in DecksService.findById / cloneDeck.
  private async assertDeckStudyable(
    userId: string,
    deckId: string,
  ): Promise<void> {
    const deck = await this.dataSource.getRepository(Deck).findOne({
      where: { id: deckId },
      select: { id: true, ownerId: true, visibility: true },
    });
    if (!deck) {
      throw new NotFoundException('deck not found');
    }
    const studyable =
      deck.ownerId === userId ||
      deck.ownerId === null ||
      deck.visibility === Visibility.PUBLIC;
    if (!studyable) {
      throw new ForbiddenException('not your deck');
    }
  }

  // Create NEW progress rows for the enrollable ids that aren't already
  // enrolled, and report the tally. Shared by both enrollment paths.
  private async persistEnrollment(
    userId: string,
    enrollableIds: string[],
    unknownVocabularyIds: string[],
  ): Promise<EnrollResponseDto> {
    if (enrollableIds.length === 0) {
      return { enrolled: 0, alreadyEnrolled: 0, unknownVocabularyIds };
    }

    const alreadyEnrolledRows = await this.progressRepo.find({
      where: { userId, vocabularyId: In(enrollableIds) },
      select: { vocabularyId: true },
    });
    const alreadyEnrolledSet = new Set(
      alreadyEnrolledRows.map((r) => r.vocabularyId),
    );

    const toCreate = enrollableIds.filter((id) => !alreadyEnrolledSet.has(id));
    if (toCreate.length > 0) {
      const rows = toCreate.map((vocabularyId) =>
        this.progressRepo.create({
          userId,
          vocabularyId,
          status: ProgressStatus.NEW,
          // Seed step 0 so the very first answer hits the intra-session
          // ladder instead of going straight to the day-scale interval.
          learningStepIndex: 0,
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

    // Free practice: a graduated card whose next review is still in the future
    // is "early". Grade it for feedback and log it for the engagement heatmap,
    // but leave the SRS schedule, status, ease, repetitions, and accuracy
    // counters untouched — an early success carries no scheduling signal, so
    // counting it would inflate the interval and defeat spaced repetition.
    // (Cards in learning steps are meant to recur within the session, and NEW
    // cards default next_review_at = now(), so neither is ever "early".)
    const isEarly =
      progress.learningStepIndex === null &&
      progress.nextReviewAt.getTime() >
        now.getTime() + this.cfg.earlyToleranceSeconds * 1000;
    if (isEarly) {
      await this.dataSource.manager.insert(LearningActivity, {
        userId,
        vocabularyId: dto.vocabularyId,
        reviewedAt: now,
        quality: dto.quality,
        isCorrect: dto.quality >= 3,
        wasNew: false,
        becameMastered: false,
        isPractice: true,
      });
      const unchanged = plainToInstance(ProgressResponseDto, progress, {
        excludeExtraneousValues: true,
      });
      unchanged.counted = false;
      return unchanged;
    }

    const next = applySm2(
      {
        status: progress.status,
        repetitions: progress.repetitions,
        easeFactor: Number(progress.easeFactor),
        intervalDays: progress.intervalDays,
        learningStepIndex: progress.learningStepIndex,
      },
      dto.quality as ReviewQuality,
      this.cfg.learningStepsMinutes,
      now,
    );

    // Capture event signals before mutating the row.
    const wasNew = progress.lastReviewedAt === null;
    const prevStatus = progress.status;

    progress.status = next.status;
    progress.repetitions = next.repetitions;
    progress.easeFactor = next.easeFactor;
    progress.intervalDays = next.intervalDays;
    progress.nextReviewAt = next.nextReviewAt;
    progress.learningStepIndex = next.learningStepIndex;
    progress.lastReviewedAt = now;
    if (dto.quality >= 3) progress.correctCount += 1;
    else progress.incorrectCount += 1;

    const becameMastered =
      prevStatus !== ProgressStatus.MASTERED &&
      next.status === ProgressStatus.MASTERED;

    // Persist the schedule update and append the activity event atomically so a
    // review can never half-record — one drives SRS, the other the heatmap,
    // streak, and new-words leaderboard.
    await this.dataSource.transaction(async (manager) => {
      await manager.save(progress);
      await manager.insert(LearningActivity, {
        userId,
        vocabularyId: dto.vocabularyId,
        reviewedAt: now,
        quality: dto.quality,
        isCorrect: dto.quality >= 3,
        wasNew,
        becameMastered,
        isPractice: false,
      });
    });

    const result = plainToInstance(ProgressResponseDto, progress, {
      excludeExtraneousValues: true,
    });
    result.counted = true;
    return result;
  }

  // Per-day study activity for a date range, bucketed by the caller's local day
  // (per `tz`) so cells match the user's midnight. Returns only active days;
  // the client fills the empty grid.
  async getActivity(
    userId: string,
    query: ActivityQueryDto,
  ): Promise<ActivityResponseDto> {
    const tz = query.tz ?? 'UTC';
    if (!isValidTimeZone(tz)) {
      throw new BadRequestException('tz must be a valid IANA timezone name');
    }

    const to = query.to ?? todayInTimeZone(tz);
    const from = query.from ?? addDaysToDateString(to, -364);
    if (to < from) {
      throw new BadRequestException('to must be on or after from');
    }
    if (dayDiff(from, to) > 366) {
      throw new BadRequestException('date range must not exceed 366 days');
    }

    const rows = await this.progressRepo.manager.query<
      { date: string; reviews: number; newWords: number }[]
    >(
      `SELECT (reviewed_at AT TIME ZONE $2)::date::text AS date,
              COUNT(*)::int AS reviews,
              COUNT(*) FILTER (WHERE was_new)::int AS "newWords"
       FROM learning_activity
       WHERE user_id = $1
         AND (reviewed_at AT TIME ZONE $2)::date >= $3::date
         AND (reviewed_at AT TIME ZONE $2)::date <= $4::date
       GROUP BY 1
       ORDER BY 1 ASC`,
      [userId, tz, from, to],
    );

    const days: ActivityDayDto[] = rows.map((r) => ({
      date: r.date,
      reviews: Number(r.reviews),
      newWords: Number(r.newWords),
    }));

    return {
      from,
      to,
      timezone: tz,
      totalReviews: days.reduce((sum, d) => sum + d.reviews, 0),
      totalNewWords: days.reduce((sum, d) => sum + d.newWords, 0),
      activeDays: days.length,
      maxReviews: days.reduce((max, d) => Math.max(max, d.reviews), 0),
      days,
    };
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
  // (otherwise the streak has been broken). Reads the activity log (exact,
  // one row per event) so the lit heatmap days and this count agree.
  private async computeStreak(userId: string): Promise<number> {
    const rows = await this.progressRepo.manager.query<{ d: string }[]>(
      `SELECT DISTINCT (reviewed_at AT TIME ZONE 'UTC')::date::text AS d
       FROM learning_activity
       WHERE user_id = $1
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

function isValidTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Current calendar date in the given IANA timezone, as YYYY-MM-DD.
function todayInTimeZone(tz: string): string {
  // en-CA renders ISO-style YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

function addDaysToDateString(dateStr: string, delta: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return toUtcDateString(d);
}

function dayDiff(fromStr: string, toStr: string): number {
  const from = new Date(`${fromStr}T00:00:00Z`).getTime();
  const to = new Date(`${toStr}T00:00:00Z`).getTime();
  return Math.round((to - from) / 86_400_000);
}
