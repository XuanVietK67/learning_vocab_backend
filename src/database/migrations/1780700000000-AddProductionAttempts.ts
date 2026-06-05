import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds production_attempts: user sentences (typed or speech-to-text) produced
// for a target word and scored asynchronously by the Gemma judge worker.
//   - Two new enums (practice_modality_enum, scoring_status_enum).
//   - cefr reuses the existing proficiency_level_enum (created with the vocab
//     schema), so this migration references it rather than creating it.
//   - rubric is jsonb (the full structured judgment); score/cefr/feedback are
//     denormalised conveniences populated when status flips to 'scored'.
export class AddProductionAttempts1780700000000 implements MigrationInterface {
  name = 'AddProductionAttempts1780700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "practice_modality_enum" AS ENUM ('writing', 'speaking')`,
    );
    await queryRunner.query(
      `CREATE TYPE "scoring_status_enum" AS ENUM ('pending', 'scored', 'failed')`,
    );

    await queryRunner.query(
      `CREATE TABLE "production_attempts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "vocabulary_id" uuid NOT NULL,
        "modality" "practice_modality_enum" NOT NULL,
        "submitted_text" text NOT NULL,
        "status" "scoring_status_enum" NOT NULL DEFAULT 'pending',
        "score" integer,
        "cefr" "proficiency_level_enum",
        "rubric" jsonb,
        "feedback" text,
        "model" character varying(64),
        "error" text,
        "scored_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_production_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_production_attempts_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_production_attempts_vocabulary" FOREIGN KEY ("vocabulary_id")
          REFERENCES "vocabularies"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_production_attempts_user_created"
        ON "production_attempts" ("user_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_production_attempts_status"
        ON "production_attempts" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_production_attempts_status"`);
    await queryRunner.query(
      `DROP INDEX "IDX_production_attempts_user_created"`,
    );
    await queryRunner.query(`DROP TABLE "production_attempts"`);
    await queryRunner.query(`DROP TYPE "scoring_status_enum"`);
    await queryRunner.query(`DROP TYPE "practice_modality_enum"`);
  }
}
