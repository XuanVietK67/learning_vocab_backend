import 'dotenv/config';
import 'tsconfig-paths/register';
import dataSource from '@/database/data-source';
import {
  type CloudinaryCreds,
  fetchPexelsImage,
  generateImage,
} from '@/vocabularies/images/image-generator';
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';

/**
 * Backfill `vocabulary_senses.image_url` for rows where it is NULL.
 *
 * Shares its generation logic with `@/vocabularies/images/image-generator`
 * (Pexels search → download → Cloudinary upload). This script owns the DB loop
 * and CLI flags.
 *
 * Idempotent and re-runnable: only touches senses with image_url IS NULL, and
 * leaves a sense NULL when Pexels has no match (abstract words), so re-running
 * after raising the Pexels quota retries exactly those.
 *
 * Runs sequentially on purpose: the free Pexels tier is ~200 requests/hour, so
 * parallelism would just trip the 429 limit. Re-run across sessions to drain a
 * large backlog, or request a higher Pexels quota.
 *
 * Flags:
 *   --limit=N    process at most N senses (default: all)
 *   --dry-run    search Pexels + log, but do not upload or write the DB
 */

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

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return JSON.stringify(err);
}

async function main(): Promise<void> {
  const { limit, dryRun } = parseArgs(process.argv);

  const pexelsApiKey = requireEnv('PEXELS_API_KEY');
  const cloudinaryCreds: CloudinaryCreds = {
    cloudName: requireEnv('CLOUDINARY_CLOUD_NAME'),
    apiKey: requireEnv('CLOUDINARY_API_KEY'),
    apiSecret: requireEnv('CLOUDINARY_API_SECRET'),
  };
  const folder = process.env.CLOUDINARY_IMAGE_FOLDER ?? 'vocab-images';

  console.log(`backfilling sense images${dryRun ? ' (dry-run)' : ''}…`);
  await dataSource.initialize();
  try {
    const senseRepo = dataSource.getRepository(VocabularySense);
    const qb = senseRepo
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.vocabulary', 'v')
      .where('s.image_url IS NULL')
      // Most-common words first so the highest-impact images land earliest.
      .orderBy('v.frequency_rank', 'ASC', 'NULLS LAST')
      .addOrderBy('v.lemma', 'ASC');
    if (limit) qb.take(limit);
    const rows = await qb.getMany();
    console.log(`  ${rows.length} senses missing image_url`);

    let filled = 0;
    let noMatch = 0;
    let failed = 0;

    for (const sense of rows) {
      const { lemma, language } = sense.vocabulary;
      try {
        if (dryRun) {
          const sourceUrl = await fetchPexelsImage(lemma, pexelsApiKey);
          if (sourceUrl) {
            filled++;
            console.log(`  ✓ ${lemma} [pexels]`);
          } else {
            noMatch++;
            console.log(`  – ${lemma} [no match]`);
          }
          continue;
        }

        const result = await generateImage(sense.id, lemma, language, lemma, {
          pexelsApiKey,
          cloudinary: cloudinaryCreds,
          folder,
        });
        if (!result) {
          noMatch++;
          console.log(`  – ${lemma} [no match]`);
          continue;
        }

        sense.imageUrl = result.url;
        await senseRepo.save(sense);
        filled++;
        console.log(`  ✓ ${lemma} [pexels]`);
      } catch (err) {
        failed++;
        console.warn(`  ✗ ${lemma}: ${toErrorMessage(err)}`);
      }
    }

    console.log(
      `done. filled=${filled} noMatch=${noMatch} failed=${failed}` +
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
