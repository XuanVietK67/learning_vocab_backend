import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds cefr_lexicon: a reference wordlist mapping (language, lemma,
// part_of_speech) to a CEFR band, loaded from an external source by the ingest
// script. The enrichment worker reads it to set cefrLevel from a deterministic
// lookup instead of asking Gemma (the first step in removing the Gemma
// dependency from quick-create). See docs/plans/quick_create_without_gemma.md.
//   - part_of_speech is '' (not null) when the level applies to the whole lemma,
//     so the unique key has no NULL holes.
//   - frequency_rank is optional provenance carried from the source.
export class CreateCefrLexicon1782400000000 implements MigrationInterface {
  name = 'CreateCefrLexicon1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "cefr_lexicon" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "language" character varying(8) NOT NULL,
        "lemma" character varying(128) NOT NULL,
        "part_of_speech" character varying(16) NOT NULL DEFAULT '',
        "cefr_level" character varying(2) NOT NULL,
        "frequency_rank" integer,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cefr_lexicon" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_cefr_lexicon_key"
        ON "cefr_lexicon" ("language", "lemma", "part_of_speech")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_cefr_lexicon_key"`);
    await queryRunner.query(`DROP TABLE "cefr_lexicon"`);
  }
}
