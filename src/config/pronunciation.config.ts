import { registerAs } from '@nestjs/config';

export default registerAs('pronunciation', () => ({
  // Base URL of the phoneme-scoring service (POST /score). Defaults to a local
  // FastAPI instance for dev; in prod point it at the deployed (private) HF
  // Space, e.g. https://xuanvietdev-pronunciation-score.hf.space.
  serviceUrl: process.env.PRONUNCIATION_SERVICE_URL ?? 'http://localhost:8000',
  // Bearer token for the private HF Space. Empty for a local/public instance —
  // the client only sends the Authorization header when this is set.
  token: process.env.PRONUNCIATION_SERVICE_TOKEN ?? '',
  // Hard timeout per outbound scoring call. The free CPU Space sleeps after
  // ~48h idle; the first request after a sleep reboots the container (model
  // load + warmup) and can take 30–60s, so default high and retry cold starts.
  timeoutMs: parseInt(process.env.PRONUNCIATION_TIMEOUT_MS ?? '60000', 10),
  // How many times to attempt a score before giving up. Retries only cold-start
  // signals (503 / timeout) with backoff; client errors (422) fail immediately.
  maxAttempts: parseInt(process.env.PRONUNCIATION_MAX_ATTEMPTS ?? '3', 10),
}));
