import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds dictionary_entry: a multilingual dictionary loaded from a Wiktionary
// export, used by the enrichment worker so non-English (and English
// dictionary-miss) lemmas go through the dictionary path instead of Gemma
// (phase 4 of docs/plans/quick_create_without_gemma.md).
//   - one row per (language, lemma, part_of_speech); senses is jsonb in the same
//     shape the English dictionary client produces.
export class CreateDictionaryEntry1782700000000 implements MigrationInterface {
  name = 'CreateDictionaryEntry1782700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "dictionary_entry" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "language" character varying(8) NOT NULL,
        "lemma" character varying(128) NOT NULL,
        "part_of_speech" character varying(16) NOT NULL,
        "ipa" character varying(128),
        "senses" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_dictionary_entry" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_dictionary_entry_key"
        ON "dictionary_entry" ("language", "lemma", "part_of_speech")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_dictionary_entry_key"`);
    await queryRunner.query(`DROP TABLE "dictionary_entry"`);
  }
}
