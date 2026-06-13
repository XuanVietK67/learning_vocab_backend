import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds vocab_enrichment_cache: the persistent enrichment cache. One row holds
// the complete model+dictionary output for a word (POS groups with IPA/CEFR and
// the full sense graph) as `content` JSONB, keyed by what makes that output
// unique: (language, lemma, translation_language). The worker reads it before
// calling the dictionary or Gemma, so a given word is enriched by the model at
// most once, ever — no matter how many users or imports request it.
//   - translation_language is '' (not null) when the entry carries no
//     translation, so the unique key has no NULL holes.
//   - model records which model produced the content (provenance/invalidation).
export class AddVocabEnrichmentCache1782000000000 implements MigrationInterface {
  name = 'AddVocabEnrichmentCache1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "vocab_enrichment_cache" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "language" character varying(8) NOT NULL,
        "lemma" character varying(128) NOT NULL,
        "translation_language" character varying(8) NOT NULL DEFAULT '',
        "content" jsonb NOT NULL,
        "model" character varying(64) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vocab_enrichment_cache" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vocab_enrichment_cache_key"
        ON "vocab_enrichment_cache" ("language", "lemma", "translation_language")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_vocab_enrichment_cache_key"`);
    await queryRunner.query(`DROP TABLE "vocab_enrichment_cache"`);
  }
}
