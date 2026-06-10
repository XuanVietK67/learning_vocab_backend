import { MigrationInterface, QueryRunner } from 'typeorm';

// Approximate, one-time seed so existing users don't start with an empty
// heatmap/streak. `user_word_progress` only keeps each word's MOST RECENT
// review, so this can recover at most one event per word — a rough starting
// calendar, not per-day precision we never had. `was_new` is best-effort
// (`repetitions <= 1`), `quality` is a neutral 3.
export class BackfillLearningActivity1781300000000 implements MigrationInterface {
  name = 'BackfillLearningActivity1781300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT INTO "learning_activity"
         ("user_id", "vocabulary_id", "reviewed_at", "quality",
          "is_correct", "was_new", "became_mastered")
       SELECT
         "user_id",
         "vocabulary_id",
         "last_reviewed_at",
         3,
         true,
         ("repetitions" <= 1),
         ("status" = 'mastered')
       FROM "user_word_progress"
       WHERE "last_reviewed_at" IS NOT NULL`,
    );
  }

  public async down(): Promise<void> {
    // The seed is an approximate snapshot that can't be precisely un-seeded
    // once real activity is interleaved. Roll this back together with
    // CreateLearningActivity (which drops the whole table) instead.
  }
}
