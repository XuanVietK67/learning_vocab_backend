import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVocabularySchema1780000000000 implements MigrationInterface {
  name = 'AddVocabularySchema1780000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ---- enums ----
    await queryRunner.query(
      `CREATE TYPE "public"."part_of_speech_enum" AS ENUM(
        'noun','verb','adjective','adverb','pronoun','preposition',
        'conjunction','interjection','phrase','other'
      )`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."vocabulary_source_enum" AS ENUM('system','user')`,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."visibility_enum" AS ENUM('system','private','public')`,
    );

    // ---- vocabularies ----
    await queryRunner.query(
      `CREATE TABLE "vocabularies" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "language" character varying(8) NOT NULL,
        "lemma" character varying(128) NOT NULL,
        "part_of_speech" "public"."part_of_speech_enum" NOT NULL,
        "ipa" character varying(128),
        "cefr_level" "public"."proficiency_level_enum",
        "frequency_rank" integer,
        "audio_url" character varying(512),
        "image_url" character varying(512),
        "source" "public"."vocabulary_source_enum" NOT NULL DEFAULT 'system',
        "created_by_user_id" uuid,
        "visibility" "public"."visibility_enum" NOT NULL DEFAULT 'system',
        "is_approved" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vocabularies" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vocabularies_created_by_user" FOREIGN KEY ("created_by_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL,
        CONSTRAINT "CK_vocabularies_source_creator" CHECK (
          (source = 'system' AND created_by_user_id IS NULL) OR
          (source = 'user' AND created_by_user_id IS NOT NULL)
        )
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vocabularies_lang_cefr_freq"
        ON "vocabularies" ("language", "cefr_level", "frequency_rank")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vocabularies_created_by_lang"
        ON "vocabularies" ("created_by_user_id", "language")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vocabularies_system_lemma"
        ON "vocabularies" ("language", "lemma", "part_of_speech")
        WHERE source = 'system'`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vocabularies_user_lemma"
        ON "vocabularies" ("created_by_user_id", "language", "lemma", "part_of_speech")
        WHERE source = 'user'`,
    );

    // ---- vocabulary_translations ----
    await queryRunner.query(
      `CREATE TABLE "vocabulary_translations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "vocabulary_id" uuid NOT NULL,
        "language" character varying(8) NOT NULL,
        "translation" character varying(255) NOT NULL,
        "note" text,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vocabulary_translations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vocabulary_translations_vocab" FOREIGN KEY ("vocabulary_id")
          REFERENCES "vocabularies"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_vocabulary_translations_vocab_lang_translation"
        ON "vocabulary_translations" ("vocabulary_id", "language", "translation")`,
    );

    // ---- vocabulary_examples ----
    await queryRunner.query(
      `CREATE TABLE "vocabulary_examples" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "vocabulary_id" uuid NOT NULL,
        "sentence" text NOT NULL,
        "translation" text,
        "source" character varying(32),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vocabulary_examples" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vocabulary_examples_vocab" FOREIGN KEY ("vocabulary_id")
          REFERENCES "vocabularies"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vocabulary_examples_vocabulary_id"
        ON "vocabulary_examples" ("vocabulary_id")`,
    );

    // ---- topics ----
    await queryRunner.query(
      `CREATE TABLE "topics" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "slug" character varying(64) NOT NULL,
        "name" character varying(128) NOT NULL,
        "description" text,
        "icon_url" character varying(512),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_topics" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_topics_slug" UNIQUE ("slug")
      )`,
    );

    // ---- vocabulary_topics (join) ----
    await queryRunner.query(
      `CREATE TABLE "vocabulary_topics" (
        "vocabulary_id" uuid NOT NULL,
        "topic_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vocabulary_topics" PRIMARY KEY ("vocabulary_id", "topic_id"),
        CONSTRAINT "FK_vocabulary_topics_vocab" FOREIGN KEY ("vocabulary_id")
          REFERENCES "vocabularies"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_vocabulary_topics_topic" FOREIGN KEY ("topic_id")
          REFERENCES "topics"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vocabulary_topics_topic_id"
        ON "vocabulary_topics" ("topic_id")`,
    );

    // ---- decks ----
    await queryRunner.query(
      `CREATE TABLE "decks" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(128) NOT NULL,
        "description" text,
        "language" character varying(8) NOT NULL,
        "cefr_level" "public"."proficiency_level_enum",
        "owner_id" uuid,
        "visibility" "public"."visibility_enum" NOT NULL DEFAULT 'system',
        "vocab_count" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_decks" PRIMARY KEY ("id"),
        CONSTRAINT "FK_decks_owner" FOREIGN KEY ("owner_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_decks_lang_cefr"
        ON "decks" ("language", "cefr_level")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_decks_owner_id" ON "decks" ("owner_id")`,
    );

    // ---- deck_vocabularies (join with order) ----
    await queryRunner.query(
      `CREATE TABLE "deck_vocabularies" (
        "deck_id" uuid NOT NULL,
        "vocabulary_id" uuid NOT NULL,
        "position" integer NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_deck_vocabularies" PRIMARY KEY ("deck_id", "vocabulary_id"),
        CONSTRAINT "FK_deck_vocabularies_deck" FOREIGN KEY ("deck_id")
          REFERENCES "decks"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_deck_vocabularies_vocab" FOREIGN KEY ("vocabulary_id")
          REFERENCES "vocabularies"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_deck_vocabularies_deck_position"
        ON "deck_vocabularies" ("deck_id", "position")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_deck_vocabularies_deck_position"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "deck_vocabularies"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_decks_owner_id"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_decks_lang_cefr"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "decks"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_vocabulary_topics_topic_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "vocabulary_topics"`);

    await queryRunner.query(`DROP TABLE IF EXISTS "topics"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_vocabulary_examples_vocabulary_id"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "vocabulary_examples"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_vocabulary_translations_vocab_lang_translation"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "vocabulary_translations"`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_vocabularies_user_lemma"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."UQ_vocabularies_system_lemma"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_vocabularies_created_by_lang"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_vocabularies_lang_cefr_freq"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "vocabularies"`);

    await queryRunner.query(`DROP TYPE IF EXISTS "public"."visibility_enum"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."vocabulary_source_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "public"."part_of_speech_enum"`,
    );
  }
}
