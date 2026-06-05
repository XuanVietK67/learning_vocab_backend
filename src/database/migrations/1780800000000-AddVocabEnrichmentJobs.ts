import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds vocab_enrichment_jobs: the quick-create queue. An admin submits only a
// lemma (+ language); the enrichment worker fills POS/ipa/definitions (dictionary)
// and examples/CEFR/gloss (Gemma) into one or more draft vocabularies.
//   - status tracks the job lifecycle (pending -> completed/failed).
//   - result_vocabulary_ids holds the draft vocab rows the job created (one per
//     resolved part of speech). Defaulted to '{}' so it is never null.
//   - requested_by_user_id is the admin who submitted, SET NULL on user delete.
export class AddVocabEnrichmentJobs1780800000000 implements MigrationInterface {
  name = 'AddVocabEnrichmentJobs1780800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "vocab_enrichment_job_status_enum" AS ENUM ('pending', 'completed', 'failed')`,
    );

    await queryRunner.query(
      `CREATE TABLE "vocab_enrichment_jobs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "language" character varying(8) NOT NULL,
        "lemma" character varying(128) NOT NULL,
        "status" "vocab_enrichment_job_status_enum" NOT NULL DEFAULT 'pending',
        "result_vocabulary_ids" uuid[] NOT NULL DEFAULT '{}',
        "error" text,
        "requested_by_user_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vocab_enrichment_jobs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vocab_enrichment_jobs_user" FOREIGN KEY ("requested_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_vocab_enrichment_jobs_status"
        ON "vocab_enrichment_jobs" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vocab_enrichment_jobs_lang_lemma"
        ON "vocab_enrichment_jobs" ("language", "lemma")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_vocab_enrichment_jobs_lang_lemma"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_vocab_enrichment_jobs_status"`);
    await queryRunner.query(`DROP TABLE "vocab_enrichment_jobs"`);
    await queryRunner.query(`DROP TYPE "vocab_enrichment_job_status_enum"`);
  }
}
