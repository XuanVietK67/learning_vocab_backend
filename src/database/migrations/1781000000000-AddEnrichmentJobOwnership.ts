import { MigrationInterface, QueryRunner } from 'typeorm';

// Lets the enrichment pipeline produce user-owned words, not just system drafts.
//   - owner_user_id: when set, the worker lands the draft as a USER-source,
//     private, auto-approved word owned by this user (vs the default null =
//     system catalog draft). Indexed for the per-user dedup lookup.
//   - target_deck_id: when set, the worker appends the produced word(s) to this
//     deck after creating them (used by the deck bulk-import flow). SET NULL on
//     deck delete so a stale job can't dangle a dropped deck.
// Both nullable so existing admin quick-create jobs keep their current behavior.
export class AddEnrichmentJobOwnership1781000000000 implements MigrationInterface {
  name = 'AddEnrichmentJobOwnership1781000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vocab_enrichment_jobs"
        ADD COLUMN "owner_user_id" uuid,
        ADD COLUMN "target_deck_id" uuid,
        ADD CONSTRAINT "FK_vocab_enrichment_jobs_owner" FOREIGN KEY ("owner_user_id")
          REFERENCES "users"("id") ON DELETE SET NULL,
        ADD CONSTRAINT "FK_vocab_enrichment_jobs_target_deck" FOREIGN KEY ("target_deck_id")
          REFERENCES "decks"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_vocab_enrichment_jobs_owner_user_id"
        ON "vocab_enrichment_jobs" ("owner_user_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "IDX_vocab_enrichment_jobs_owner_user_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vocab_enrichment_jobs"
        DROP CONSTRAINT "FK_vocab_enrichment_jobs_target_deck",
        DROP CONSTRAINT "FK_vocab_enrichment_jobs_owner",
        DROP COLUMN "target_deck_id",
        DROP COLUMN "owner_user_id"`,
    );
  }
}
