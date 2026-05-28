import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserWeeklyVocabGoal1780400000000 implements MigrationInterface {
  name = 'AddUserWeeklyVocabGoal1780400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "weekly_vocab_goal" smallint`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" ADD CONSTRAINT "CK_users_weekly_vocab_goal" CHECK ("weekly_vocab_goal" IS NULL OR ("weekly_vocab_goal" BETWEEN 5 AND 250))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP CONSTRAINT "CK_users_weekly_vocab_goal"`,
    );

    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "weekly_vocab_goal"`,
    );
  }
}
