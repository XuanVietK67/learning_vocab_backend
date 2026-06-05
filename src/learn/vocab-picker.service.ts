import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, LessThanOrEqual, Repository } from 'typeorm';
import { DeckVocabulary } from '@/decks/entities/deck-vocabulary.entity';
import { SessionEmptyReason } from '@/learn/dto/session-item.dto';
import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { Topic } from '@/topics/entities/topic.entity';
import { ProficiencyLevel } from '@/users/entities/proficiency-level.enum';
import { User } from '@/users/entities/user.entity';
import { VocabularySource } from '@/vocabularies/entities/vocabulary-source.enum';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

const CEFR_ORDER: ProficiencyLevel[] = [
  ProficiencyLevel.A1,
  ProficiencyLevel.A2,
  ProficiencyLevel.B1,
  ProficiencyLevel.B2,
  ProficiencyLevel.C1,
  ProficiencyLevel.C2,
];

export interface PickResult {
  // vocab the user already has progress on and is currently due, ordered by
  // next_review_at ASC (oldest due first)
  dueVocabIds: string[];
  // vocab the user does NOT have progress on, ordered by frequency_rank ASC
  // (most-common-first). The caller auto-enrolls these.
  freshVocabIds: string[];
  // Non-null only when both arrays are empty.
  emptyReason: SessionEmptyReason | null;
}

@Injectable()
export class VocabPickerService {
  constructor(
    @InjectRepository(UserWordProgress)
    private readonly progressRepo: Repository<UserWordProgress>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    @InjectRepository(DeckVocabulary)
    private readonly deckVocabRepo: Repository<DeckVocabulary>,
    @InjectRepository(Topic) private readonly topicRepo: Repository<Topic>,
  ) {}

  // -------------------- daily --------------------
  async pickDaily(user: User, limit: number): Promise<PickResult> {
    this.requireOnboarded(user, 'daily');

    const due = await this.findDueIds(user.id, limit);
    if (due.length >= limit) {
      return { dueVocabIds: due, freshVocabIds: [], emptyReason: null };
    }

    const need = limit - due.length;
    const fresh = await this.findFreshIds(user, need, /* topicSlug */ null);
    if (due.length === 0 && fresh.length === 0) {
      return {
        dueVocabIds: [],
        freshVocabIds: [],
        emptyReason: 'no_more_at_level',
      };
    }
    return { dueVocabIds: due, freshVocabIds: fresh, emptyReason: null };
  }

  // -------------------- topic --------------------
  async pickByTopic(
    user: User,
    slug: string,
    limit: number,
  ): Promise<PickResult> {
    this.requireOnboarded(user, 'topic');

    const topic = await this.topicRepo.findOne({ where: { slug } });
    if (!topic) {
      throw new NotFoundException(`topic "${slug}" not found`);
    }

    const due = await this.findDueIdsInTopic(user.id, topic.id, limit);
    const need = limit - due.length;
    const fresh = need > 0 ? await this.findFreshIds(user, need, topic.id) : [];

    if (due.length === 0 && fresh.length === 0) {
      return {
        dueVocabIds: [],
        freshVocabIds: [],
        emptyReason: 'no_more_at_level',
      };
    }
    return { dueVocabIds: due, freshVocabIds: fresh, emptyReason: null };
  }

  // -------------------- deck --------------------
  async pickByDeck(
    user: User,
    deckId: string,
    limit: number,
  ): Promise<PickResult> {
    // Confirm the deck has any members at all — otherwise this is a 404-ish
    // situation (deck doesn't exist, is empty, or the user can't see it).
    const memberCount = await this.deckVocabRepo.count({ where: { deckId } });
    if (memberCount === 0) {
      throw new NotFoundException('deck not found or has no vocabularies');
    }

    const due = await this.findDueIdsInDeck(user.id, deckId, limit);
    const need = limit - due.length;
    const fresh =
      need > 0 ? await this.findFreshIdsInDeck(user.id, deckId, need) : [];

    if (due.length === 0 && fresh.length === 0) {
      return {
        dueVocabIds: [],
        freshVocabIds: [],
        emptyReason: 'deck_exhausted',
      };
    }
    return { dueVocabIds: due, freshVocabIds: fresh, emptyReason: null };
  }

  // -------------------- review --------------------
  async pickReview(user: User, limit: number): Promise<PickResult> {
    // Quick check: does this user have any progress rows at all?
    const anyProgress = await this.progressRepo.count({
      where: { userId: user.id },
    });
    if (anyProgress === 0) {
      return {
        dueVocabIds: [],
        freshVocabIds: [],
        emptyReason: 'no_enrollment',
      };
    }

    const rows = await this.progressRepo.find({
      where: {
        userId: user.id,
        nextReviewAt: LessThanOrEqual(new Date()),
        status: In([
          ProgressStatus.LEARNING,
          ProgressStatus.REVIEW,
          ProgressStatus.MASTERED,
        ]),
      },
      order: { nextReviewAt: 'ASC' },
      take: limit,
      select: { vocabularyId: true, nextReviewAt: true },
    });

    if (rows.length === 0) {
      return {
        dueVocabIds: [],
        freshVocabIds: [],
        emptyReason: 'no_due_cards',
      };
    }
    return {
      dueVocabIds: rows.map((r) => r.vocabularyId),
      freshVocabIds: [],
      emptyReason: null,
    };
  }

  // ------------------- internals -------------------

  private requireOnboarded(user: User, mode: string): void {
    if (!user.targetLanguage || !user.proficiencyLevel) {
      throw new BadRequestException(
        `mode=${mode} requires onboarding (targetLanguage and proficiencyLevel)`,
      );
    }
  }

  private async findDueIds(userId: string, limit: number): Promise<string[]> {
    const rows = await this.progressRepo.find({
      where: { userId, nextReviewAt: LessThanOrEqual(new Date()) },
      order: { nextReviewAt: 'ASC' },
      take: limit,
      select: { vocabularyId: true },
    });
    return rows.map((r) => r.vocabularyId);
  }

  private async findDueIdsInTopic(
    userId: string,
    topicId: string,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.progressRepo
      .createQueryBuilder('p')
      .select('p.vocabulary_id', 'vocabularyId')
      .innerJoin(
        'vocabulary_topics',
        'vt',
        'vt.vocabulary_id = p.vocabulary_id AND vt.topic_id = :topicId',
        { topicId },
      )
      .where('p.user_id = :userId', { userId })
      .andWhere('p.next_review_at <= :now', { now: new Date() })
      .orderBy('p.next_review_at', 'ASC')
      .limit(limit)
      .getRawMany<{ vocabularyId: string }>();
    return rows.map((r) => r.vocabularyId);
  }

  private async findDueIdsInDeck(
    userId: string,
    deckId: string,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.progressRepo
      .createQueryBuilder('p')
      .select('p.vocabulary_id', 'vocabularyId')
      .innerJoin(
        'deck_vocabularies',
        'dv',
        'dv.vocabulary_id = p.vocabulary_id AND dv.deck_id = :deckId',
        { deckId },
      )
      .where('p.user_id = :userId', { userId })
      .andWhere('p.next_review_at <= :now', { now: new Date() })
      .orderBy('p.next_review_at', 'ASC')
      .limit(limit)
      .getRawMany<{ vocabularyId: string }>();
    return rows.map((r) => r.vocabularyId);
  }

  // Fresh = not in user_word_progress for this user. Language match,
  // system source (or user's own). Topic filter optional.
  //
  // Level matching is a *preference*, not a hard filter: we order by how far
  // each word's CEFR is from the learner's level (closest first), then by
  // frequency. This way a learner who has exhausted their CEFR ±1 band — or
  // whose remaining words have no cefr_level at all — still gets the most
  // suitable words available instead of an empty session.
  private async findFreshIds(
    user: User,
    limit: number,
    topicId: string | null,
  ): Promise<string[]> {
    const qb = this.vocabRepo
      .createQueryBuilder('v')
      .select('v.id', 'id')
      .where('v.language = :lang', { lang: user.targetLanguage })
      .andWhere(
        // System words must be approved to be served; a learner's own words do
        // not need approval. Keeps quick-create drafts (system, unapproved) out
        // of sessions while leaving user-created vocab untouched.
        '((v.source = :system AND v.is_approved = true) OR (v.source = :user AND v.created_by_user_id = :userId))',
        {
          system: VocabularySource.SYSTEM,
          user: VocabularySource.USER,
          userId: user.id,
        },
      )
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM user_word_progress p
          WHERE p.user_id = :userId AND p.vocabulary_id = v.id
        )`,
        { userId: user.id },
      );

    if (topicId) {
      qb.andWhere(
        `EXISTS (
          SELECT 1 FROM vocabulary_topics vt
          WHERE vt.vocabulary_id = v.id AND vt.topic_id = :topicId
        )`,
        { topicId },
      );
    }

    // Prefer words closest to the learner's CEFR level. Words with no
    // cefr_level (distance is NULL) sort last but are still eligible.
    const userIdx = user.proficiencyLevel
      ? CEFR_ORDER.indexOf(user.proficiencyLevel)
      : -1;
    if (userIdx >= 0) {
      qb.orderBy(
        `ABS(${cefrOrdinalCase('v.cefr_level')} - ${userIdx})`,
        'ASC',
        'NULLS LAST',
      );
    }

    qb.addOrderBy('v.frequency_rank', 'ASC', 'NULLS LAST').limit(limit);
    const rows = await qb.getRawMany<{ id: string }>();
    return rows.map((r) => r.id);
  }

  private async findFreshIdsInDeck(
    userId: string,
    deckId: string,
    limit: number,
  ): Promise<string[]> {
    const rows = await this.deckVocabRepo
      .createQueryBuilder('dv')
      .select('dv.vocabulary_id', 'vocabularyId')
      .where('dv.deck_id = :deckId', { deckId })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM user_word_progress p
          WHERE p.user_id = :userId AND p.vocabulary_id = dv.vocabulary_id
        )`,
        { userId },
      )
      .orderBy('dv.position', 'ASC')
      .limit(limit)
      .getRawMany<{ vocabularyId: string }>();
    return rows.map((r) => r.vocabularyId);
  }
}

// Build a SQL CASE that maps a cefr_level enum column to its ordinal
// (A1→0 … C2→5). Unknown/NULL levels yield NULL, so callers can sort them
// last with NULLS LAST. The level strings come from the enum, so the
// interpolation is safe.
function cefrOrdinalCase(column: string): string {
  const whens = CEFR_ORDER.map(
    (level, idx) => `WHEN '${level}' THEN ${idx}`,
  ).join(' ');
  return `CASE ${column} ${whens} END`;
}
