import { Readable } from 'stream';
import { v2 as cloudinary, type ConfigOptions } from 'cloudinary';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

/**
 * Framework-agnostic audio generation, shared by the BullMQ audio worker and
 * the one-off backfill script. No NestJS, no DB, no DI — just pure functions.
 *
 * Pipeline: dictionary recording (real human audio) → Edge-TTS fallback →
 * upload the resulting mp3 to Cloudinary and return the secure URL.
 */

export interface CloudinaryCreds {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface GenerateAudioOptions {
  cloudinary: CloudinaryCreds;
  folder: string;
  ttsVoice: string;
}

export interface GeneratedAudio {
  url: string;
  via: 'dictionary' | 'tts';
}

/**
 * Look up a real recording from the free Dictionary API. Returns the first
 * non-empty audio URL, or null if the word/audio is not available.
 */
export async function fetchDictionaryAudio(
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

/**
 * Synthesize an mp3 with Edge-TTS (Microsoft's free neural voices, no API key).
 * Edge-TTS takes plain text only (no SSML <phoneme>), so IPA is not used here —
 * the dictionary supplies the pronunciation-critical common words; TTS only
 * covers the long tail.
 */
export async function synthesizeWithEdgeTts(
  lemma: string,
  voice: string,
): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(lemma);
  const buffer = await streamToBuffer(audioStream);
  if (buffer.length === 0) throw new Error('TTS returned empty audio');
  return buffer;
}

/** Upload an mp3 buffer to Cloudinary, returning the secure CDN URL. */
export async function uploadAudioToCloudinary(
  buffer: Buffer,
  publicId: string,
  creds: CloudinaryCreds,
  folder: string,
): Promise<string> {
  const config: ConfigOptions = {
    cloud_name: creds.cloudName,
    api_key: creds.apiKey,
    api_secret: creds.apiSecret,
  };
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        resource_type: 'video',
        folder,
        public_id: publicId,
        overwrite: true,
        ...config,
      },
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

/** Build a Cloudinary-safe public id from the vocabulary's identity. */
export function buildAudioPublicId(
  language: string,
  lemma: string,
  vocabId: string,
): string {
  return `${language}_${lemma}_${vocabId}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

/**
 * Full pipeline for one word: dictionary → TTS fallback → Cloudinary upload.
 * Returns the stored URL and which source produced the audio.
 */
export async function generateAudio(
  vocabId: string,
  lemma: string,
  language: string,
  opts: GenerateAudioOptions,
): Promise<GeneratedAudio> {
  let buffer: Buffer;
  let via: 'dictionary' | 'tts';

  const dictUrl = await fetchDictionaryAudio(lemma, language);
  if (dictUrl) {
    buffer = await downloadBuffer(dictUrl);
    via = 'dictionary';
  } else {
    buffer = await synthesizeWithEdgeTts(lemma, opts.ttsVoice);
    via = 'tts';
  }

  const publicId = buildAudioPublicId(language, lemma, vocabId);
  const url = await uploadAudioToCloudinary(
    buffer,
    publicId,
    opts.cloudinary,
    opts.folder,
  );
  return { url, via };
}
