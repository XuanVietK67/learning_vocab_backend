import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLearningStepIndex1780500000000 implements MigrationInterface {
  name = 'AddLearningStepIndex1780500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_word_progress" ADD COLUMN "learning_step_index" smallint`,
    );

    // Seed every existing row in the NEW status into step 0 so the first
    // answer hits the intra-session ladder. Already-graduated rows stay
    // NULL and keep their day-scale schedule.
    await queryRunner.query(
      `UPDATE "user_word_progress" SET "learning_step_index" = 0 WHERE "status" = 'new'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user_word_progress" DROP COLUMN "learning_step_index"`,
    );
  }
}
