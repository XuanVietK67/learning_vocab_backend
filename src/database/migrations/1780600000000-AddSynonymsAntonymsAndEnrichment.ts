import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds dictionary-enrichment storage:
//   - synonyms/antonyms as text[] on vocabulary_senses (display-only word lists,
//     sense-scoped). Defaulted to '{}' so existing rows stay valid and consumers
//     always receive an array.
//   - enrichment_status / enriched_at on vocabularies to track the lifecycle of
//     rows created with minimal data and filled by a background job. NULL means
//     the row was created with full data (nothing to enrich).
//   - source on vocabulary_translations to record provenance (manual | mt:* |
//     cambridge), mirroring vocabulary_examples.source.
// All new columns are nullable or defaulted, so no backfill is needed.
export class AddSynonymsAntonymsAndEnrichment1780600000000 implements MigrationInterface {
  name = 'AddSynonymsAntonymsAndEnrichment1780600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vocabulary_senses"
        ADD COLUMN "synonyms" text[] NOT NULL DEFAULT '{}',
        ADD COLUMN "antonyms" text[] NOT NULL DEFAULT '{}'`,
    );

    await queryRunner.query(
      `CREATE TYPE "enrichment_status_enum" AS ENUM ('pending', 'enriched', 'failed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabularies"
        ADD COLUMN "enrichment_status" "enrichment_status_enum",
        ADD COLUMN "enriched_at" TIMESTAMP WITH TIME ZONE`,
    );

    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations"
        ADD COLUMN "source" character varying(32)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations" DROP COLUMN "source"`,
    );

    await queryRunner.query(
      `ALTER TABLE "vocabularies" DROP COLUMN "enriched_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabularies" DROP COLUMN "enrichment_status"`,
    );
    await queryRunner.query(`DROP TYPE "enrichment_status_enum"`);

    await queryRunner.query(
      `ALTER TABLE "vocabulary_senses" DROP COLUMN "antonyms"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_senses" DROP COLUMN "synonyms"`,
    );
  }
}
