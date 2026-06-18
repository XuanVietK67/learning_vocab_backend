import 'dotenv/config';
import 'tsconfig-paths/register';
import { IsNull, Like } from 'typeorm';
import dataSource from '@/database/data-source';
import { composeIpaFromWords } from '@/vocabularies/enrichment/dictionary-client';
import { VocabEnrichmentCache } from '@/vocabularies/entities/vocab-enrichment-cache.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

/**
 * Backfill `vocabularies.ipa` for English multi-word rows where it is NULL.
 *
 * Multi-word lemmas (e.g. "income disparities") 404 against the dictionary as a
 * whole, so the enrichment worker historically saved them with ipa = NULL. This
 * script reconstructs the IPA from per-word dictionary lookups (the same
 * `composeIpaFromWords` the worker now uses) and updates the rows. It also drops
 * any stale enrichment-cache entry for a fixed lemma so a future re-enrichment
 * recomputes instead of replaying the old null-IPA draft.
 *
 * Dictionary-only (no Gemma): words the dictionary can't cover stay NULL and can
 * be re-enriched later. Idempotent and re-runnable.
 *
 * Flags:
 *   --limit=N    process at most N rows (default: all)
 *   --dry-run    compute + log, but do not write the DB
 */

const DICTIONARY_TIMEOUT_MS = 10_000;

interface Args {
  limit: number | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | null = null;
  let dryRun = false;
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isNaN(n) && n > 0) limit = n;
    }
  }
  return { limit, dryRun };
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return JSON.stringify(err);
}

async function main(): Promise<void> {
  const { limit, dryRun } = parseArgs(process.argv);

  console.log(`backfilling vocabulary IPA${dryRun ? ' (dry-run)' : ''}…`);
  await dataSource.initialize();
  try {
    const repo = dataSource.getRepository(Vocabulary);
    const cacheRepo = dataSource.getRepository(VocabEnrichmentCache);

    // English, multi-word (lemma contains a space), still missing IPA.
    const rows = await repo.find({
      where: { ipa: IsNull(), language: 'en', lemma: Like('% %') },
      order: { frequencyRank: 'ASC' },
      ...(limit ? { take: limit } : {}),
    });
    console.log(`  ${rows.length} multi-word rows missing ipa`);

    // One lookup per distinct lemma, reused across rows that share it.
    const ipaByLemma = new Map<string, string | null>();
    let filled = 0;
    let unresolved = 0;
    let failed = 0;

    for (const vocab of rows) {
      try {
        let ipa = ipaByLemma.get(vocab.lemma);
        if (ipa === undefined) {
          ipa = await composeIpaFromWords(vocab.lemma, DICTIONARY_TIMEOUT_MS);
          ipaByLemma.set(vocab.lemma, ipa);
        }

        if (!ipa) {
          unresolved++;
          console.log(`  – ${vocab.lemma}: no IPA resolvable`);
          continue;
        }

        if (!dryRun) {
          vocab.ipa = ipa;
          await repo.save(vocab);
          // Drop stale cache for this lemma (all translation variants) so a
          // future re-enrichment recomputes the now-fixed IPA.
          await cacheRepo.delete({ language: 'en', lemma: vocab.lemma });
        }
        filled++;
        console.log(`  ✓ ${vocab.lemma} → ${ipa}`);
      } catch (err) {
        failed++;
        console.warn(`  ✗ ${vocab.lemma}: ${toErrorMessage(err)}`);
      }
    }

    console.log(
      `done. filled=${filled} unresolved=${unresolved} failed=${failed}` +
        (dryRun ? ' (no DB writes — dry-run)' : ''),
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
