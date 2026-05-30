import 'dotenv/config';
import 'tsconfig-paths/register';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { IsNull } from 'typeorm';
import dataSource from '@/database/data-source';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

/**
 * Backfill `vocabularies.audio_url` for rows where it is NULL.
 *
 * Pipeline per word:
 *   1. Dictionary source — fetch a real human recording from dictionaryapi.dev.
 *   2. TTS fallback — synthesize with Edge-TTS (Microsoft's free neural voices,
 *      no API key) for words the dictionary has no recording for.
 *   3. Upload the resulting mp3 to Cloudinary and persist the returned URL.
 *
 * Idempotent and re-runnable: only touches rows with audio_url IS NULL.
 *
 * Note: Edge-TTS uses plain text input (no SSML <phoneme>), so the stored IPA
 * is not used to shape pronunciation — the dictionary supplies the
 * pronunciation-critical common words; TTS only covers the long tail.
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

/**
 * Look up a real recording from the free Dictionary API. Returns the first
 * non-empty audio URL, or null if the word/audio is not available.
 */
async function fetchDictionaryAudio(
  lemma: string,
  language: string,
): Promise<string | null> {
  const lang = encodeURIComponent(language.toLowerCase());
  const word = encodeURIComponent(lemma.toLowerCase());
  const url = `https://api.dictionaryapi.dev/api/v2/entries/${lang}/${word}`;

  const res = await fetch(url);
  if (!res.ok) return null; // 404 = word not found

  const entries = (await res.json()) as Array<{
    phonetics?: Array<{ audio?: string }>;
  }>;
  for (const entry of entries) {
    for (const ph of entry.phonetics ?? []) {
      const audio = ph.audio?.trim();
      if (audio) return audio.startsWith('//') ? `https:${audio}` : audio;
    }
  }
  return null;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

/** Synthesize an mp3 with Edge-TTS using the pre-configured client. */
async function synthesizeTts(tts: MsEdgeTTS, lemma: string): Promise<Buffer> {
  const { audioStream } = tts.toStream(lemma);
  const buffer = await streamToBuffer(audioStream);
  if (buffer.length === 0) throw new Error('TTS returned empty audio');
  return buffer;
}

/** Upload an mp3 buffer to Cloudinary, returning the secure CDN URL. */
async function uploadToCloudinary(
  buffer: Buffer,
  publicId: string,
  folder: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: 'video', folder, public_id: publicId, overwrite: true },
      (err, result) => {
        if (err) {
          return reject(new Error(err.message ?? 'Cloudinary upload failed'));
        }
        if (!result?.secure_url) {
          return reject(new Error('Cloudinary upload returned no secure_url'));
        }
        resolve(result.secure_url);
      },
    );
    stream.end(buffer);
  });
}

async function main(): Promise<void> {
  const { limit, dryRun } = parseArgs(process.argv);

  cloudinary.config({
    cloud_name: requireEnv('CLOUDINARY_CLOUD_NAME'),
    api_key: requireEnv('CLOUDINARY_API_KEY'),
    api_secret: requireEnv('CLOUDINARY_API_SECRET'),
  });
  const folder = process.env.CLOUDINARY_AUDIO_FOLDER ?? 'vocab-audio';
  const voice = process.env.TTS_VOICE ?? 'en-US-AriaNeural';

  // Configure the Edge-TTS client once (opens a reusable WebSocket connection).
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

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
        let buffer: Buffer;
        let via: 'dictionary' | 'tts';

        const dictUrl = await fetchDictionaryAudio(vocab.lemma, vocab.language);
        if (dictUrl) {
          buffer = await downloadBuffer(dictUrl);
          via = 'dictionary';
        } else {
          buffer = await synthesizeTts(tts, vocab.lemma);
          via = 'tts';
        }

        if (!dryRun) {
          const publicId = `${vocab.language}_${vocab.lemma}_${vocab.id}`
            .toLowerCase()
            .replace(/[^a-z0-9_-]/g, '-');
          const audioUrl = await uploadToCloudinary(buffer, publicId, folder);
          vocab.audioUrl = audioUrl;
          await repo.save(vocab);
        }

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
