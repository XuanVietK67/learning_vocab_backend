import 'dotenv/config';
import 'tsconfig-paths/register';
import { IsNull } from 'typeorm';
import dataSource from '@/database/data-source';
import {
  type CloudinaryCreds,
  fetchDictionaryAudio,
  generateAudio,
  synthesizeWithEdgeTts,
} from '@/vocabularies/audio/audio-generator';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

/**
 * Backfill `vocabularies.audio_url` for rows where it is NULL.
 *
 * Shares its generation logic with the audio worker via
 * `@/vocabularies/audio/audio-generator` (dictionary recording → Edge-TTS
 * fallback → Cloudinary upload). This script owns the DB loop and CLI flags.
 *
 * Idempotent and re-runnable: only touches rows with audio_url IS NULL.
 *
 * Flags:
 *   --limit=N    process at most N rows (default: all)
 *   --dry-run    fetch/synthesize + log, but do not upload or write the DB
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

  const cloudinaryCreds: CloudinaryCreds = {
    cloudName: requireEnv('CLOUDINARY_CLOUD_NAME'),
    apiKey: requireEnv('CLOUDINARY_API_KEY'),
    apiSecret: requireEnv('CLOUDINARY_API_SECRET'),
  };
  const folder = process.env.CLOUDINARY_AUDIO_FOLDER ?? 'vocab-audio';
  const ttsVoice = process.env.TTS_VOICE ?? 'en-US-AriaNeural';

  console.log(`backfilling vocabulary audio${dryRun ? ' (dry-run)' : ''}…`);
  await dataSource.initialize();
  try {
    const repo = dataSource.getRepository(Vocabulary);
    const rows = await repo.find({
      where: { audioUrl: IsNull() },
      order: { frequencyRank: 'ASC' },
      ...(limit ? { take: limit } : {}),
    });
    console.log(`  ${rows.length} rows missing audio_url`);

    let fromDict = 0;
    let fromTts = 0;
    let failed = 0;

    for (const vocab of rows) {
      try {
        if (dryRun) {
          // Resolve the source without uploading or writing the DB.
          const dictUrl = await fetchDictionaryAudio(
            vocab.lemma,
            vocab.language,
          );
          if (dictUrl) {
            fromDict++;
          } else {
            await synthesizeWithEdgeTts(vocab.lemma, ttsVoice);
            fromTts++;
          }
          console.log(`  ✓ ${vocab.lemma} [${dictUrl ? 'dictionary' : 'tts'}]`);
          continue;
        }

        const { url, via } = await generateAudio(
          vocab.id,
          vocab.lemma,
          vocab.language,
          { cloudinary: cloudinaryCreds, folder, ttsVoice },
        );
        vocab.audioUrl = url;
        await repo.save(vocab);

        if (via === 'dictionary') fromDict++;
        else fromTts++;
        console.log(`  ✓ ${vocab.lemma} [${via}]`);
      } catch (err) {
        failed++;
        console.warn(`  ✗ ${vocab.lemma}: ${toErrorMessage(err)}`);
      }
    }

    console.log(
      `done. dictionary=${fromDict} tts=${fromTts} failed=${failed}` +
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
