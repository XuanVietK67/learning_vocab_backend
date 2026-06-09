import { registerAs } from '@nestjs/config';

export default registerAs('pronunciation', () => ({
  // Base URL of the Python FastAPI scoring service (POST /score).
  serviceUrl: process.env.PRONUNCIATION_SERVICE_URL ?? 'http://localhost:8000',
  // Hard timeout for the outbound scoring call. The model runs on CPU; a single
  // word should score in well under 1.5s, so 8s leaves headroom for cold starts.
  timeoutMs: parseInt(process.env.PRONUNCIATION_TIMEOUT_MS ?? '8000', 10),
}));
