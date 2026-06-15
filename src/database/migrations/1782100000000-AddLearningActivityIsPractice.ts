import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLearningActivityIsPractice1782100000000 implements MigrationInterface {
  name = 'AddLearningActivityIsPractice1782100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Existing rows backfill to false via the default — every historical event
    // was a scheduled review, not free practice.
    await queryRunner.query(
      `ALTER TABLE "learning_activity" ADD COLUMN "is_practice" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "learning_activity" DROP COLUMN "is_practice"`,
    );
  }
}
