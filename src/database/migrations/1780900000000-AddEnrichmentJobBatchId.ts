import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds batch_id to vocab_enrichment_jobs so a bulk quick-create (a list/file of
// lemmas submitted together) can group its per-lemma jobs under one id for
// progress tracking. Nullable — single-lemma quick-create jobs leave it null,
// so no backfill is needed.
export class AddEnrichmentJobBatchId1780900000000 implements MigrationInterface {
  name = 'AddEnrichmentJobBatchId1780900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vocab_enrichment_jobs" ADD COLUMN "batch_id" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vocab_enrichment_jobs_batch_id"
        ON "vocab_enrichment_jobs" ("batch_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_vocab_enrichment_jobs_batch_id"`);
    await queryRunner.query(
      `ALTER TABLE "vocab_enrichment_jobs" DROP COLUMN "batch_id"`,
    );
  }
}
