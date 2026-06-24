import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds `scenarios`: admin-authored speaking-room specs (Phase 1). Each row is a
// reusable spec (setting, roles, goal, opening line) practiced by many learners
// in Phase 2.
//   - cefr_level reuses the existing proficiency_level_enum; NULL means "any".
//   - intro_video_* are present but inert in Phase 1 (no HyperFrames render yet).
//   - status drives the draft -> published -> retired lifecycle.
//   - created_by is the authoring admin, SET NULL on user delete.
export class CreateSpeakingRoomScenarios1782200000000 implements MigrationInterface {
  name = 'CreateSpeakingRoomScenarios1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "scenario_status_enum" AS ENUM ('draft', 'published', 'retired')`,
    );

    await queryRunner.query(
      `CREATE TABLE "scenarios" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "title" character varying(160) NOT NULL,
        "topic" character varying(64) NOT NULL,
        "cefr_level" "proficiency_level_enum",
        "setting" text NOT NULL,
        "ai_role" character varying(120) NOT NULL,
        "user_role" character varying(120) NOT NULL,
        "goal" text NOT NULL,
        "opening_line" text NOT NULL,
        "seed_phrases" text[] NOT NULL DEFAULT '{}',
        "est_turns" smallint,
        "intro_video_script" text,
        "intro_video_url" character varying(512),
        "status" "scenario_status_enum" NOT NULL DEFAULT 'draft',
        "version" integer NOT NULL DEFAULT 1,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_scenarios" PRIMARY KEY ("id"),
        CONSTRAINT "FK_scenarios_created_by" FOREIGN KEY ("created_by")
          REFERENCES "users"("id") ON DELETE SET NULL
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_scenarios_topic" ON "scenarios" ("topic")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scenarios_status" ON "scenarios" ("status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_scenarios_cefr_level" ON "scenarios" ("cefr_level")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_scenarios_cefr_level"`);
    await queryRunner.query(`DROP INDEX "IDX_scenarios_status"`);
    await queryRunner.query(`DROP INDEX "IDX_scenarios_topic"`);
    await queryRunner.query(`DROP TABLE "scenarios"`);
    await queryRunner.query(`DROP TYPE "scenario_status_enum"`);
  }
}
