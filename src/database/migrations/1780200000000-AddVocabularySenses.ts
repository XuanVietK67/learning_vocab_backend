import { MigrationInterface, QueryRunner } from 'typeorm';

// Introduces vocabulary_senses to support polysemous words. Translations and
// examples move from being hung directly off a vocabulary to being hung off a
// specific sense (meaning) of that vocabulary. Image_url also moves from the
// vocabulary down to the sense, since different meanings of the same word
// typically need different illustrations. Audio stays on the vocabulary since
// pronunciation is shared across senses.
//
// Backfill creates exactly one sense (sense_order = 1) per existing vocabulary
// and re-points existing translations/examples at it. Rollback is LOSSY: any
// secondary senses (sense_order > 1) inserted after this migration are dropped
// when down() collapses the data back onto the vocabulary level.
export class AddVocabularySenses1780200000000 implements MigrationInterface {
  name = 'AddVocabularySenses1780200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- 1. Create vocabulary_senses ----
    await queryRunner.query(
      `CREATE TABLE "vocabulary_senses" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "vocabulary_id" uuid NOT NULL,
        "sense_order" smallint NOT NULL DEFAULT 1,
        "gloss" character varying(128),
        "definition" text,
        "image_url" character varying(512),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vocabulary_senses" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vocabulary_senses_vocab" FOREIGN KEY ("vocabulary_id")
          REFERENCES "vocabularies"("id") ON DELETE CASCADE,
        CONSTRAINT "CK_vocabulary_senses_order_positive"
          CHECK ("sense_order" >= 1)
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vocabulary_senses_vocab_order"
        ON "vocabulary_senses" ("vocabulary_id", "sense_order")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vocabulary_senses_vocabulary_id"
        ON "vocabulary_senses" ("vocabulary_id")`,
    );

    // ---- 2. Backfill one sense per existing vocabulary ----
    await queryRunner.query(
      `INSERT INTO "vocabulary_senses" ("vocabulary_id", "sense_order", "image_url")
       SELECT "id", 1, "image_url" FROM "vocabularies"`,
    );

    // ---- 3. Add sense_id to vocabulary_translations ----
    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations"
        ADD COLUMN "sense_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "vocabulary_translations" vt
        SET "sense_id" = vs."id"
        FROM "vocabulary_senses" vs
        WHERE vs."vocabulary_id" = vt."vocabulary_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations"
        ALTER COLUMN "sense_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations"
        ADD CONSTRAINT "FK_vocabulary_translations_sense"
        FOREIGN KEY ("sense_id") REFERENCES "vocabulary_senses"("id") ON DELETE CASCADE`,
    );

    // ---- 4. Add sense_id to vocabulary_examples ----
    await queryRunner.query(
      `ALTER TABLE "vocabulary_examples"
        ADD COLUMN "sense_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "vocabulary_examples" ve
        SET "sense_id" = vs."id"
        FROM "vocabulary_senses" vs
        WHERE vs."vocabulary_id" = ve."vocabulary_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_examples"
        ALTER COLUMN "sense_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_examples"
        ADD CONSTRAINT "FK_vocabulary_examples_sense"
        FOREIGN KEY ("sense_id") REFERENCES "vocabulary_senses"("id") ON DELETE CASCADE`,
    );

    // ---- 5. Swap unique index on translations ----
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vocabulary_translations_vocab_lang_translation"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vocabulary_translations_sense_lang_translation"
        ON "vocabulary_translations" ("sense_id", "language", "translation")`,
    );

    // ---- 6. Drop old vocabulary_id columns + index on examples ----
    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations"
        DROP CONSTRAINT "FK_vocabulary_translations_vocab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations" DROP COLUMN "vocabulary_id"`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_vocabulary_examples_vocabulary_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_examples"
        DROP CONSTRAINT "FK_vocabulary_examples_vocab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_examples" DROP COLUMN "vocabulary_id"`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vocabulary_examples_sense_id"
        ON "vocabulary_examples" ("sense_id")`,
    );

    // ---- 7. Drop image_url from vocabularies (moved to sense level) ----
    await queryRunner.query(
      `ALTER TABLE "vocabularies" DROP COLUMN "image_url"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // ---- 7. Re-add image_url to vocabularies, backfill from sense 1 ----
    await queryRunner.query(
      `ALTER TABLE "vocabularies"
        ADD COLUMN "image_url" character varying(512)`,
    );
    await queryRunner.query(
      `UPDATE "vocabularies" v
        SET "image_url" = vs."image_url"
        FROM "vocabulary_senses" vs
        WHERE vs."vocabulary_id" = v."id" AND vs."sense_order" = 1`,
    );

    // ---- 6. Restore vocabulary_id on examples and translations ----
    await queryRunner.query(
      `DROP INDEX "public"."IDX_vocabulary_examples_sense_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_examples" ADD COLUMN "vocabulary_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "vocabulary_examples" ve
        SET "vocabulary_id" = vs."vocabulary_id"
        FROM "vocabulary_senses" vs
        WHERE vs."id" = ve."sense_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_examples"
        ALTER COLUMN "vocabulary_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_examples"
        ADD CONSTRAINT "FK_vocabulary_examples_vocab"
        FOREIGN KEY ("vocabulary_id") REFERENCES "vocabularies"("id") ON DELETE CASCADE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vocabulary_examples_vocabulary_id"
        ON "vocabulary_examples" ("vocabulary_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations" ADD COLUMN "vocabulary_id" uuid`,
    );
    await queryRunner.query(
      `UPDATE "vocabulary_translations" vt
        SET "vocabulary_id" = vs."vocabulary_id"
        FROM "vocabulary_senses" vs
        WHERE vs."id" = vt."sense_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations"
        ALTER COLUMN "vocabulary_id" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations"
        ADD CONSTRAINT "FK_vocabulary_translations_vocab"
        FOREIGN KEY ("vocabulary_id") REFERENCES "vocabularies"("id") ON DELETE CASCADE`,
    );

    // ---- 5. Restore unique index on translations ----
    // Note: lossy. If multiple senses had identical (lang, translation) rows
    // for the same vocab, this DELETE collapses them to one.
    await queryRunner.query(
      `DROP INDEX "public"."UQ_vocabulary_translations_sense_lang_translation"`,
    );
    await queryRunner.query(
      `DELETE FROM "vocabulary_translations" a
        USING "vocabulary_translations" b
        WHERE a.ctid < b.ctid
          AND a."vocabulary_id" = b."vocabulary_id"
          AND a."language" = b."language"
          AND a."translation" = b."translation"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vocabulary_translations_vocab_lang_translation"
        ON "vocabulary_translations" ("vocabulary_id", "language", "translation")`,
    );

    // ---- 4. Drop sense_id from examples ----
    await queryRunner.query(
      `ALTER TABLE "vocabulary_examples"
        DROP CONSTRAINT "FK_vocabulary_examples_sense"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_examples" DROP COLUMN "sense_id"`,
    );

    // ---- 3. Drop sense_id from translations ----
    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations"
        DROP CONSTRAINT "FK_vocabulary_translations_sense"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocabulary_translations" DROP COLUMN "sense_id"`,
    );

    // ---- 1. Drop vocabulary_senses ----
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_vocabulary_senses_vocabulary_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_vocabulary_senses_vocab_order"`,
    );
    await queryRunner.query(`DROP TABLE "vocabulary_senses"`);
  }
}
