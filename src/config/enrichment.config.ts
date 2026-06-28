import { registerAs } from '@nestjs/config';

// Configuration for the quick-create enrichment pipeline as it moves off Gemma
// (see docs/plans/quick_create_without_gemma.md).
export default registerAs('enrichment', () => ({
  // OPUS-MT translation sidecar (a small self-hosted Marian/CTranslate2 service).
  // An empty base URL DISABLES the MT fallback, so translation is then served
  // only from the bilingual lexicon. Contract: POST {baseUrl}/translate with
  // JSON { text, source, target } -> { translation }.
  opusMtBaseUrl: process.env.OPUS_MT_BASE_URL ?? '',
  opusMtTimeoutMs: parseInt(process.env.OPUS_MT_TIMEOUT_MS ?? '10000', 10),

  // Master switch for the Gemma fallback. While true (the default during the
  // transition) the worker still calls Gemma to fill fields no non-Gemma source
  // could cover. Set ENRICHMENT_USE_GEMMA_FALLBACK=false to make the pipeline
  // fully Gemma-free: missing fields are left empty/editable instead.
  useGemmaFallback: process.env.ENRICHMENT_USE_GEMMA_FALLBACK !== 'false',
}));
