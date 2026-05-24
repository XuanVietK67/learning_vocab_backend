import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSocialAuthAndRefreshTokens1779800000000 implements MigrationInterface {
  name = 'AddSocialAuthAndRefreshTokens1779800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "username" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ADD COLUMN "avatar_url" character varying(512)`,
    );

    await queryRunner.query(
      `DROP INDEX "public"."IDX_fe0bb3f6520ee0469504521e71"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_users_username_unique" ON "users" ("username") WHERE "username" IS NOT NULL`,
    );

    await queryRunner.query(
      `CREATE TYPE "public"."auth_provider_enum" AS ENUM('google', 'apple', 'github')`,
    );
    await queryRunner.query(
      `CREATE TABLE "user_identities" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "provider" "public"."auth_provider_enum" NOT NULL,
        "provider_user_id" character varying(255) NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_identities" PRIMARY KEY ("id"),
        CONSTRAINT "FK_user_identities_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_user_identities_provider_provider_user_id" ON "user_identities" ("provider", "provider_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_user_identities_user_id" ON "user_identities" ("user_id")`,
    );

    await queryRunner.query(
      `CREATE TABLE "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "user_id" uuid NOT NULL,
        "token_hash" character varying(255) NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "user_agent" character varying(512),
        "ip_address" character varying(64),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_refresh_tokens" PRIMARY KEY ("id"),
        CONSTRAINT "FK_refresh_tokens_user_id" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "UQ_refresh_tokens_token_hash" ON "refresh_tokens" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."IDX_refresh_tokens_user_id"`);
    await queryRunner.query(
      `DROP INDEX "public"."UQ_refresh_tokens_token_hash"`,
    );
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);

    await queryRunner.query(
      `DROP INDEX "public"."IDX_user_identities_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."UQ_user_identities_provider_provider_user_id"`,
    );
    await queryRunner.query(`DROP TABLE "user_identities"`);
    await queryRunner.query(`DROP TYPE "public"."auth_provider_enum"`);

    await queryRunner.query(`DROP INDEX "public"."IDX_users_username_unique"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_fe0bb3f6520ee0469504521e71" ON "users" ("username")`,
    );

    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "avatar_url"`);
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "username" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "users" ALTER COLUMN "password_hash" SET NOT NULL`,
    );
  }
}
