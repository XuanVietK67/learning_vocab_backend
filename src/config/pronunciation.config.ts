import { registerAs } from '@nestjs/config';

// Pronunciation scoring (Azure Speech) configuration. Azure assesses against a
// single target locale per call; `en` is normalized to `defaultLocale` before
// the request (see src/pronunciation/speech/locale.ts).
export default registerAs('pronunciation', () => ({
  azure: {
    key: process.env.AZURE_SPEECH_KEY ?? '',
    region: process.env.AZURE_SPEECH_REGION ?? '',
    // Locale used when the request omits one (or sends the coarse `en`).
    defaultLocale: process.env.AZURE_SPEECH_LOCALE ?? 'en-US',
  },
  // Overall PronScore at/above which an attempt counts as passed.
  passThreshold: parseInt(process.env.PRONUNCIATION_PASS_THRESHOLD ?? '70', 10),
  // Hard cap on clip length to bound Azure cost/latency.
  maxAudioSeconds: parseInt(
    process.env.PRONUNCIATION_MAX_AUDIO_SECONDS ?? '15',
    10,
  ),
  // Reject uploads larger than this before transcoding (bytes). Default 5 MB.
  maxUploadBytes: parseInt(
    process.env.PRONUNCIATION_MAX_UPLOAD_BYTES ?? '5242880',
    10,
  ),
  // Per-user throttle window for the scoring endpoint.
  rateTtlSeconds: parseInt(process.env.PRONUNCIATION_RATE_TTL ?? '60', 10),
  rateLimit: parseInt(process.env.PRONUNCIATION_RATE_LIMIT ?? '20', 10),
}));
