import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserWordProgress1780100000000 implements MigrationInterface {
  name = 'AddUserWordProgress1780100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."progress_status_enum" AS ENUM('new', 'learning', 'review', 'mastered')`,
    );

    await queryRunner.query(
      `CREATE TABLE "user_word_progress" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "vocabulary_id" uuid NOT NULL,
        "status" "public"."progress_status_enum" NOT NULL DEFAULT 'new',
        "repetitions" integer NOT NULL DEFAULT 0,
        "ease_factor" numeric(4,2) NOT NULL DEFAULT 2.50,
        "interval_days" integer NOT NULL DEFAULT 0,
        "next_review_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "last_reviewed_at" TIMESTAMP WITH TIME ZONE,
        "correct_count" integer NOT NULL DEFAULT 0,
        "incorrect_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_word_progress" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_word_progress_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_word_progress_vocab" FOREIGN KEY ("vocabulary_id")
          REFERENCES "vocabularies"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_user_word_progress_ease_factor"
          CHECK ("ease_factor" >= 1.30),
        CONSTRAINT "CK_user_word_progress_interval_days"
          CHECK ("interval_days" >= 0)
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_word_progress_user_vocab"
        ON "user_word_progress" ("user_id", "vocabulary_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_word_progress_user_next_review"
        ON "user_word_progress" ("user_id", "next_review_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_word_progress_user_status"
        ON "user_word_progress" ("user_id", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_user_word_progress_user_status"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_user_word_progress_user_next_review"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_user_word_progress_user_vocab"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_word_progress"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."progress_status_enum"`,
    );
  }
}
