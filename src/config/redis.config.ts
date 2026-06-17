import { registerAs } from '@nestjs/config';

const DEFAULT_PORT = 6379;

/**
 * Parse a port string defensively. Returns undefined for blank or non-numeric
 * input (e.g. an empty `REDIS_PORT` from a mis-referenced platform variable) so
 * the caller can fall back instead of handing BullMQ a `NaN` port, which throws
 * "Port should be >= 0 and < 65536. Received type number (NaN)".
 */
function toPort(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n < 65536 ? n : undefined;
}

export default registerAs('redis', () => {
  // Managed Redis (Railway, Upstash, Heroku…) usually exposes a single
  // connection URL. Prefer it when present; otherwise use discrete host/port/
  // password vars (local/dev).
  const url = process.env.REDIS_URL;
  if (url) {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: toPort(parsed.port) ?? DEFAULT_PORT,
      password: parsed.password || undefined,
    };
  }

  return {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: toPort(process.env.REDIS_PORT) ?? DEFAULT_PORT,
    // Local/dev Redis runs auth-less; omitted from the connection when blank.
    password: process.env.REDIS_PASSWORD || undefined,
  };
});
