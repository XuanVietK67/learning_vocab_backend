import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserOnboardingFields1779900000000 implements MigrationInterface {
  name = 'AddUserOnboardingFields1779900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "public"."proficiency_level_enum" AS ENUM('A1', 'A2', 'B1', 'B2', 'C1', 'C2')`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "native_language" character varying(8)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "target_language" character varying(8)`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "proficiency_level" "public"."proficiency_level_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "daily_goal_minutes" smallint`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CK_users_daily_goal_minutes" CHECK ("daily_goal_minutes" IS NULL OR ("daily_goal_minutes" BETWEEN 5 AND 240))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CK_users_daily_goal_minutes"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "daily_goal_minutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "proficiency_level"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "target_language"`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "native_language"`,
    );

    await queryRunner.query(`DROP TYPE "public"."proficiency_level_enum"`);
  }
}
