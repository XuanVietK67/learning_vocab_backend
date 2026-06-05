import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds topic_slugs to vocab_enrichment_jobs so a bulk quick-create can carry the
// admin's chosen topic(s) through to the worker, which links every draft it
// creates to them. Non-null with a '{}' default — existing jobs backfill to an
// empty array, matching the no-topic case.
export class AddEnrichmentJobTopicSlugs1780900100000 implements MigrationInterface {
  name = 'AddEnrichmentJobTopicSlugs1780900100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vocab_enrichment_jobs"
        ADD COLUMN "topic_slugs" text[] NOT NULL DEFAULT '{}'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vocab_enrichment_jobs" DROP COLUMN "topic_slugs"`,
    );
  }
}
