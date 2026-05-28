import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEmailVerificationCodes1780300000000 implements MigrationInterface {
  name = 'AddEmailVerificationCodes1780300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "email_verification_codes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "code_hash" character varying(255) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "attempts" smallint NOT NULL DEFAULT 0,
        "consumed_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_email_verification_codes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_email_verification_codes_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_email_verification_codes_user_id" ON "email_verification_codes" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_email_verification_codes_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "email_verification_codes"`);
  }
}
