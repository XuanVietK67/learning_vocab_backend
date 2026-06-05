import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds translation_language to vocab_enrichment_jobs so a quick-create request
// can carry the admin's chosen target language through to the worker, which asks
// Gemma for a per-sense translation in that language. Nullable: existing jobs
// (and requests that omit it) fall back to the configured default at processing.
export class AddEnrichmentJobTranslationLanguage1780900200000 implements MigrationInterface {
  name = 'AddEnrichmentJobTranslationLanguage1780900200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vocab_enrichment_jobs"
        ADD COLUMN "translation_language" character varying(8)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vocab_enrichment_jobs" DROP COLUMN "translation_language"`,
    );
  }
}
