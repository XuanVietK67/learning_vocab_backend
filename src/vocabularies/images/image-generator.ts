import { v2 as cloudinary, type ConfigOptions } from 'cloudinary';

/**
 * Framework-agnostic image generation, shared by the image backfill script (and
 * a future BullMQ image worker). No NestJS, no DB, no DI — just pure functions.
 *
 * Pipeline: search the free Pexels stock-photo API by the word → download the
 * top result → upload it to Cloudinary and return the secure URL.
 *
 * Pexels has no good match for many abstract words (justice, although). When
 * the search returns nothing, `generateImage` returns null and the caller leaves
 * `image_url` NULL for an admin to fill manually — the long tail of concrete
 * words is what this clears automatically.
 */

export interface CloudinaryCreds {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
}

export interface GenerateImageOptions {
  pexelsApiKey: string;
  cloudinary: CloudinaryCreds;
  folder: string;
}

export interface GeneratedImage {
  /** The Cloudinary URL the image was mirrored to. */
  url: string;
  /** The original Pexels CDN URL the photo came from. */
  sourceUrl: string;
}

interface PexelsSearchResponse {
  photos?: Array<{
    src?: {
      large?: string;
      medium?: string;
      original?: string;
    };
  }>;
}

/**
 * Search Pexels for a single stock photo matching `query` (typically the
 * lemma). Returns the URL of the top result, or null when there is no match.
 * Prefers the `large` rendition (~940px), falling back to medium/original.
 */
export async function fetchPexelsImage(
  query: string,
  apiKey: string,
): Promise<string | null> {
  const q = encodeURIComponent(query.trim());
  const url = `https://api.pexels.com/v1/search?query=${q}&per_page=1&orientation=square`;

  const res = await fetch(url, { headers: { Authorization: apiKey } });
  if (!res.ok) {
    // 429 = rate limited, 4xx/5xx = transient or bad key. Let the caller decide
    // how to treat a miss vs. a hard error by surfacing rate limits explicitly.
    if (res.status === 429) {
      throw new Error('Pexels rate limit hit (429)');
    }
    return null;
  }

  const body = (await res.json()) as PexelsSearchResponse;
  const src = body.photos?.[0]?.src;
  return src?.large ?? src?.medium ?? src?.original ?? null;
}

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

/** Upload an image buffer to Cloudinary, returning the secure CDN URL. */
export async function uploadImageToCloudinary(
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
        resource_type: 'image',
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

/** Build a Cloudinary-safe public id from the sense's identity. */
export function buildImagePublicId(
  language: string,
  lemma: string,
  senseId: string,
): string {
  return `${language}_${lemma}_${senseId}`
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

/**
 * Full pipeline for one sense: Pexels search → download → Cloudinary upload.
 * Returns the stored URL and the original source URL, or null when Pexels has
 * no match for the query.
 */
export async function generateImage(
  senseId: string,
  query: string,
  language: string,
  lemma: string,
  opts: GenerateImageOptions,
): Promise<GeneratedImage | null> {
  const sourceUrl = await fetchPexelsImage(query, opts.pexelsApiKey);
  if (!sourceUrl) return null;

  const buffer = await downloadBuffer(sourceUrl);
  const publicId = buildImagePublicId(language, lemma, senseId);
  const url = await uploadImageToCloudinary(
    buffer,
    publicId,
    opts.cloudinary,
    opts.folder,
  );
  return { url, sourceUrl };
}
