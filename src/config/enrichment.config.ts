import { registerAs } from '@nestjs/config';

// Configuration for the quick-create enrichment pipeline as it moves off Gemma
// (see docs/plans/quick_create_without_gemma.md).
export default registerAs('enrichment', () => ({
  // Self-hosted OPUS-MT (Helsinki-NLP/Marian) sidecar — the MT backend for both
  // the per-word translation fallback and example-sentence translation. An empty
  // URL DISABLES MT, so translation is then served only from the bilingual
  // lexicon. Mirrors the pronunciation-scoring service shape (URL + Bearer token).
  opusMtServiceUrl: process.env.OPUS_MT_SERVICE_URL ?? '',
  opusMtToken: process.env.OPUS_MT_TOKEN ?? '',
  opusMtTimeoutMs: parseInt(process.env.OPUS_MT_TIMEOUT_MS ?? '15000', 10),
  opusMtMaxAttempts: parseInt(process.env.OPUS_MT_MAX_ATTEMPTS ?? '2', 10),

  // Master switch for the Gemma fallback. While true (the default during the
  // transition) the worker still calls Gemma to fill fields no non-Gemma source
  // could cover. Set ENRICHMENT_USE_GEMMA_FALLBACK=false to make the pipeline
  // fully Gemma-free: missing fields are left empty/editable instead.
  useGemmaFallback: process.env.ENRICHMENT_USE_GEMMA_FALLBACK !== 'false',
}));
