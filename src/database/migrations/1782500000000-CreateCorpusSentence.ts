import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds corpus_sentence: real example sentences from an external corpus (e.g.
// Tatoeba), loaded by the ingest script. The enrichment worker retrieves them
// as example sentences for a lemma via full-text search instead of asking Gemma
// to generate them (phase 2 of removing the Gemma dependency from quick-create;
// see docs/plans/quick_create_without_gemma.md).
//   - search_vector is a tsvector built at ingest with the language's text
//     search config (so an inflected form matches the lemma); GIN-indexed.
//   - (language, gdex_score) btree backs the "order best examples first" query.
export class CreateCorpusSentence1782500000000 implements MigrationInterface {
  name = 'CreateCorpusSentence1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "corpus_sentence" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "language" character varying(8) NOT NULL,
        "text" text NOT NULL,
        "word_count" integer NOT NULL,
        "gdex_score" real NOT NULL,
        "source" character varying(32) NOT NULL,
        "search_vector" tsvector NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_corpus_sentence" PRIMARY KEY ("id")
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_corpus_sentence_search"
        ON "corpus_sentence" USING GIN ("search_vector")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_corpus_sentence_rank"
        ON "corpus_sentence" ("language", "gdex_score")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_corpus_sentence_rank"`);
    await queryRunner.query(`DROP INDEX "IDX_corpus_sentence_search"`);
    await queryRunner.query(`DROP TABLE "corpus_sentence"`);
  }
}
