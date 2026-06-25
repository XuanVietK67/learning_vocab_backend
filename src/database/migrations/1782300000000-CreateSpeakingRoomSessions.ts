import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the Phase 2 live-practice tables: `speaking_sessions` (one learner run of
// a scenario, with a frozen scenario snapshot + chosen words + the end-of-session
// report) and `speaking_turns` (the interleaved AI/user transcript).
//   - scenario_snapshot freezes the scenario's text so an admin edit (which bumps
//     the scenario version in place) can't change an in-flight conversation.
//   - cefr_level reuses the existing proficiency_level_enum; NULL means "any".
//   - report stays NULL until the session is ended.
export class CreateSpeakingRoomSessions1782300000000 implements MigrationInterface {
  name = 'CreateSpeakingRoomSessions1782300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "speaking_session_status_enum" AS ENUM ('active', 'ended')`,
    );
    await queryRunner.query(
      `CREATE TYPE "speaking_report_status_enum" AS ENUM ('pending', 'ready', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "speaking_turn_role_enum" AS ENUM ('ai', 'user')`,
    );

    await queryRunner.query(
      `CREATE TABLE "speaking_sessions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "scenario_id" uuid NOT NULL,
        "scenario_version" integer NOT NULL,
        "scenario_snapshot" jsonb NOT NULL,
        "cefr_level" "proficiency_level_enum",
        "selected_vocabulary_ids" uuid[] NOT NULL DEFAULT '{}',
        "selected_words" text[] NOT NULL DEFAULT '{}',
        "status" "speaking_session_status_enum" NOT NULL DEFAULT 'active',
        "report_status" "speaking_report_status_enum" NOT NULL DEFAULT 'pending',
        "report" jsonb,
        "report_model" character varying(64),
        "ended_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_speaking_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_speaking_sessions_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_speaking_sessions_scenario" FOREIGN KEY ("scenario_id")
          REFERENCES "scenarios"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_speaking_sessions_user_created" ON "speaking_sessions" ("user_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_speaking_sessions_scenario" ON "speaking_sessions" ("scenario_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "speaking_turns" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "session_id" uuid NOT NULL,
        "turn_index" integer NOT NULL,
        "role" "speaking_turn_role_enum" NOT NULL,
        "text" text NOT NULL,
        "corrections" jsonb,
        "used_target_words" text[] NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_speaking_turns" PRIMARY KEY ("id"),
        CONSTRAINT "FK_speaking_turns_session" FOREIGN KEY ("session_id")
          REFERENCES "speaking_sessions"("id") ON DELETE CASCADE
      )`,
    );

    await queryRunner.query(
      `CREATE INDEX "IDX_speaking_turns_session_index" ON "speaking_turns" ("session_id", "turn_index")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_speaking_turns_session_index"`);
    await queryRunner.query(`DROP TABLE "speaking_turns"`);
    await queryRunner.query(`DROP INDEX "IDX_speaking_sessions_scenario"`);
    await queryRunner.query(`DROP INDEX "IDX_speaking_sessions_user_created"`);
    await queryRunner.query(`DROP TABLE "speaking_sessions"`);
    await queryRunner.query(`DROP TYPE "speaking_turn_role_enum"`);
    await queryRunner.query(`DROP TYPE "speaking_report_status_enum"`);
    await queryRunner.query(`DROP TYPE "speaking_session_status_enum"`);
  }
}
