import { registerAs } from '@nestjs/config';

// Groq (OpenAI-compatible chat completions). Used synchronously by the
// speaking-room scenario draft helper (admin authoring) — NOT routed through a
// BullMQ queue. The free tier is rate-limited per project, so callers may supply
// several keys for rotation (see common/groq/groq-request.ts).
export default registerAs('groq', () => ({
  // One or more API keys for rotation. Prefer GROQ_API_KEYS (comma-separated,
  // each from a different account) to raise the free-tier 429 ceiling; falls
  // back to the single GROQ_API_KEY. Empty means the draft helper is disabled.
  apiKeys: (process.env.GROQ_API_KEYS ?? process.env.GROQ_API_KEY ?? '')
    .split(',')
    .map((k) => k.trim())
    .filter((k) => k.length > 0),
  // OpenAI-compatible base; the client POSTs `${baseUrl}/chat/completions`.
  baseUrl: process.env.GROQ_BASE_URL ?? 'https://api.groq.com/openai/v1',
  // Fast, free-tier-friendly model for short JSON drafting.
  model: process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant',
  // Per-request timeout for the chat-completion call.
  timeoutMs: parseInt(process.env.GROQ_TIMEOUT_MS ?? '30000', 10),
}));
