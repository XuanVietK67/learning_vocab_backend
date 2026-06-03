import { MigrationInterface, QueryRunner } from 'typeorm';

// Stores one row per pronunciation attempt: the reference text the learner was
// asked to say, the locale it was graded against, Azure's overall + sub-scores,
// and the per-phoneme breakdown (jsonb) for later review/aggregation.
// vocab_id is nullable and unused in Phase 1 (reserved for progress/SRS); a
// deleted vocab nulls it out, a deleted user removes the attempts.
export class AddPronunciationAttempts1780700000000 implements MigrationInterface {
  name = 'AddPronunciationAttempts1780700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "pronunciation_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "vocab_id" uuid,
        "reference_text" text NOT NULL,
        "recognized_text" text,
        "locale" character varying(16) NOT NULL,
        "overall_score" numeric(5,2) NOT NULL,
        "accuracy_score" numeric(5,2),
        "fluency_score" numeric(5,2),
        "completeness_score" numeric(5,2),
        "prosody_score" numeric(5,2),
        "passed" boolean NOT NULL,
        "phonemes" jsonb,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_pronunciation_attempts" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_pronunciation_attempts_user_id"
        ON "pronunciation_attempts" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pronunciation_attempts_vocab_id"
        ON "pronunciation_attempts" ("vocab_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "pronunciation_attempts"
        ADD CONSTRAINT "FK_pronunciation_attempts_user_id"
        FOREIGN KEY ("user_id") REFERENCES "users" ("id")
        ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pronunciation_attempts"
        ADD CONSTRAINT "FK_pronunciation_attempts_vocab_id"
        FOREIGN KEY ("vocab_id") REFERENCES "vocabularies" ("id")
        ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pronunciation_attempts" DROP CONSTRAINT "FK_pronunciation_attempts_vocab_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pronunciation_attempts" DROP CONSTRAINT "FK_pronunciation_attempts_user_id"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_pronunciation_attempts_vocab_id"`);
    await queryRunner.query(`DROP INDEX "IDX_pronunciation_attempts_user_id"`);
    await queryRunner.query(`DROP TABLE "pronunciation_attempts"`);
  }
}
