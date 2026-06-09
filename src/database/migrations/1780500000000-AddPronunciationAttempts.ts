import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPronunciationAttempts1780500000000 implements MigrationInterface {
  name = 'AddPronunciationAttempts1780500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "pronunciation_attempts" (` +
        `"id" uuid NOT NULL DEFAULT uuid_generate_v4(), ` +
        `"user_id" uuid NOT NULL, ` +
        `"vocabulary_id" uuid, ` +
        `"word" character varying(128) NOT NULL, ` +
        `"overall_score" smallint NOT NULL, ` +
        `"phoneme_scores" jsonb NOT NULL, ` +
        `"audio_quality" jsonb, ` +
        `"model_version" character varying(64) NOT NULL, ` +
        `"audio_url" character varying(512), ` +
        `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), ` +
        `CONSTRAINT "PK_pronunciation_attempts" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `ALTER TABLE "pronunciation_attempts" ADD CONSTRAINT "FK_pron_attempts_user" ` +
        `FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "pronunciation_attempts" ADD CONSTRAINT "FK_pron_attempts_vocab" ` +
        `FOREIGN KEY ("vocabulary_id") REFERENCES "vocabularies"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pron_attempts_user_created" ON "pronunciation_attempts" ("user_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_pron_attempts_user_vocab" ON "pronunciation_attempts" ("user_id", "vocabulary_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pron_attempts_user_vocab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_pron_attempts_user_created"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pronunciation_attempts" DROP CONSTRAINT "FK_pron_attempts_vocab"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pronunciation_attempts" DROP CONSTRAINT "FK_pron_attempts_user"`,
    );
    await queryRunner.query(`DROP TABLE "pronunciation_attempts"`);
  }
}
