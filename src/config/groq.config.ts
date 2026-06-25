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
  // Fast, free-tier-friendly model for short JSON drafting (scenario draft).
  model: process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant',
  // Model for the live speaking-room turns: must be fast (it is in the user's
  // round-trip every turn). Defaults to the same small instant model.
  chatModel: process.env.GROQ_CHAT_MODEL ?? 'llama-3.1-8b-instant',
  // Smarter, slower model for the one end-of-session feedback report (not in the
  // per-turn loop, so latency matters less than quality — see plan §2.4).
  reportModel: process.env.GROQ_REPORT_MODEL ?? 'llama-3.3-70b-versatile',
  // Per-request timeout for the chat-completion call.
  timeoutMs: parseInt(process.env.GROQ_TIMEOUT_MS ?? '30000', 10),
  // Per-user cap on speaking sessions started per day (protects the free tier).
  dailySessionsPerUser: parseInt(
    process.env.GROQ_DAILY_SESSIONS_PER_USER ?? '20',
    10,
  ),
  // Hard cap on user turns per session (stops a runaway conversation burning
  // quota); the learner must end the session once reached.
  maxTurnsPerSession: parseInt(
    process.env.GROQ_MAX_TURNS_PER_SESSION ?? '40',
    10,
  ),
}));
