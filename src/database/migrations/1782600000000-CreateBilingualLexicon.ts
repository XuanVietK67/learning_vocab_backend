import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds bilingual_lexicon: word/sense-level translations loaded from an open
// lexicon, used by the enrichment worker to translate a lemma without Gemma
// (phase 3 of docs/plans/quick_create_without_gemma.md). Doubles as the OPUS-MT
// cache — sidecar results are written back with source='opus-mt'.
//   - part_of_speech is '' (not null) when the translation applies to the whole
//     lemma (how MT results are stored), so the unique key has no NULL holes.
export class CreateBilingualLexicon1782600000000 implements MigrationInterface {
  name = 'CreateBilingualLexicon1782600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "bilingual_lexicon" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "source_language" character varying(8) NOT NULL,
        "target_language" character varying(8) NOT NULL,
        "lemma" character varying(128) NOT NULL,
        "part_of_speech" character varying(16) NOT NULL DEFAULT '',
        "translation" character varying(255) NOT NULL,
        "source" character varying(32) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_bilingual_lexicon" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_bilingual_lexicon_key"
        ON "bilingual_lexicon"
        ("source_language", "target_language", "lemma", "part_of_speech")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_bilingual_lexicon_key"`);
    await queryRunner.query(`DROP TABLE "bilingual_lexicon"`);
  }
}
