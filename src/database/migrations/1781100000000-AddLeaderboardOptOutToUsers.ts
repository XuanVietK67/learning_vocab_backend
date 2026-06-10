import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeaderboardOptOutToUsers1781100000000 implements MigrationInterface {
  name = 'AddLeaderboardOptOutToUsers1781100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "leaderboard_opt_out" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" DROP COLUMN "leaderboard_opt_out"`,
    );
  }
}
