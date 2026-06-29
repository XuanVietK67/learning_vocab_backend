import 'dotenv/config';
import 'tsconfig-paths/register';
import { IsNull } from 'typeorm';
import dataSource from '@/database/data-source';
import { translateViaOpusMt } from '@/vocabularies/enrichment/sources/opus-mt.client';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';

/**
 * Backfill `vocabulary_examples.translation` for rows where it is NULL.
 *
 * Translates each example sentence into the configured default target language
 * (ENRICHMENT_TRANSLATION_LANGUAGE, default 'vi') via the same self-hosted
 * OPUS-MT sidecar the enrichment worker uses, shared through
 * `@/vocabularies/enrichment/sources/opus-mt.client`. This script owns the DB
 * loop and CLI flags.
 *
 * Idempotent and re-runnable: only touches rows with translation IS NULL, and
 * only writes a row when MT actually returns a translation.
 *
 * Requires OPUS_MT_SERVICE_URL to be set (otherwise there is nothing to do).
 *
 * Flags:
 *   --limit=N        process at most N rows (default: all)
 *   --target=xx      override the target language (default: env / 'vi')
 *   --dry-run        translate + log, but do not write the DB
 */

const CHUNK_SIZE = 50;

interface Args {
  limit: number | null;
  target: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let limit: number | null = null;
  let target = process.env.ENRICHMENT_TRANSLATION_LANGUAGE ?? 'vi';
  let dryRun = false;
  for (const arg of argv.slice(2)) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg.startsWith('--limit=')) {
      const n = parseInt(arg.slice('--limit='.length), 10);
      if (!Number.isNaN(n) && n > 0) limit = n;
    } else if (arg.startsWith('--target=')) {
      const v = arg.slice('--target='.length).trim();
      if (v) target = v;
    }
  }
  return { limit, target, dryRun };
}

interface PendingRow {
  id: string;
  sentence: string;
  language: string;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

async function main(): Promise<void> {
  const { limit, target, dryRun } = parseArgs(process.argv);

  const serviceUrl = process.env.OPUS_MT_SERVICE_URL ?? '';
  if (!serviceUrl) {
    console.error(
      'OPUS_MT_SERVICE_URL is not set — cannot translate. Aborting.',
    );
    process.exit(1);
  }
  const opusMtOptions = {
    serviceUrl,
    token: process.env.OPUS_MT_TOKEN ?? '',
    timeoutMs: parseInt(process.env.OPUS_MT_TIMEOUT_MS ?? '15000', 10),
    maxAttempts: parseInt(process.env.OPUS_MT_MAX_ATTEMPTS ?? '2', 10),
  };

  console.log(
    `backfilling example translations → ${target}${dryRun ? ' (dry-run)' : ''}…`,
  );
  await dataSource.initialize();
  try {
    const repo = dataSource.getRepository(VocabularyExample);
    const qb = repo
      .createQueryBuilder('ex')
      .innerJoin('ex.sense', 'sense')
      .innerJoin('sense.vocabulary', 'vocab')
      .where('ex.translation IS NULL')
      // Skip sentences already in the target language — nothing to translate.
      .andWhere('vocab.language <> :target', { target })
      .select('ex.id', 'id')
      .addSelect('ex.sentence', 'sentence')
      .addSelect('vocab.language', 'language')
      .orderBy('vocab.language', 'ASC');
    if (limit) qb.limit(limit);

    const rows = await qb.getRawMany<PendingRow>();
    console.log(`  ${rows.length} example(s) missing a translation`);

    // Group by source language so each OPUS-MT batch is single-direction.
    const byLanguage = new Map<string, PendingRow[]>();
    for (const row of rows) {
      const bucket = byLanguage.get(row.language);
      if (bucket) bucket.push(row);
      else byLanguage.set(row.language, [row]);
    }

    let updated = 0;
    let skipped = 0;

    for (const [language, group] of byLanguage) {
      for (const batch of chunk(group, CHUNK_SIZE)) {
        const sentences = batch.map((r) => r.sentence);
        const translated = await translateViaOpusMt(
          opusMtOptions,
          language,
          target,
          sentences,
        );
        for (let i = 0; i < batch.length; i++) {
          const t = translated[i];
          if (!t) {
            skipped++;
            continue;
          }
          if (dryRun) {
            console.log(`  ✓ [${language}->${target}] ${batch[i].sentence}`);
          } else {
            await repo.update(
              { id: batch[i].id, translation: IsNull() },
              {
                translation: t,
              },
            );
          }
          updated++;
        }
      }
    }

    console.log(
      `done. translated=${updated} skipped=${skipped}` +
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
