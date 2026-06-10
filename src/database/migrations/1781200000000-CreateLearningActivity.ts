import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLearningActivity1781200000000 implements MigrationInterface {
  name = 'CreateLearningActivity1781200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "learning_activity" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "vocabulary_id" uuid,
        "reviewed_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "quality" smallint NOT NULL,
        "is_correct" boolean NOT NULL,
        "was_new" boolean NOT NULL,
        "became_mastered" boolean NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_learning_activity" PRIMARY KEY ("id"),
        CONSTRAINT "FK_learning_activity_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_learning_activity_vocab" FOREIGN KEY ("vocabulary_id")
          REFERENCES "vocabularies"("id") ON DELETE SET NULL,
        CONSTRAINT "CK_learning_activity_quality"
          CHECK ("quality" BETWEEN 0 AND 5)
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_learning_activity_user_reviewed"
        ON "learning_activity" ("user_id", "reviewed_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "public"."IDX_learning_activity_user_reviewed"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "learning_activity"`);
  }
}
