import { registerAs } from '@nestjs/config';

// Gemma judge (Google AI Studio free tier). Scores production sentences async.
// The free tier is rate-limited, so the worker throttles itself (see
// requestsPerMinute) and retries on 429 via BullMQ backoff rather than failing
// the user. dailyAttemptsPerUser bounds how many submissions one user can spend
// against the single shared key per UTC day.
export default registerAs('gemma', () => ({
  apiKey: process.env.GEMMA_API_KEY ?? '',
  baseUrl:
    process.env.GEMMA_BASE_URL ??
    'https://generativelanguage.googleapis.com/v1beta',
  // gemini-2.5-flash-lite, not a Gemma model: Google retired gemma-3-* from AI
  // Studio, and the gemma-4-* replacements are reasoning models that (a) always
  // spend the output budget on hidden "thinking" tokens and (b) reject
  // thinkingConfig, so their JSON gets truncated (finishReason MAX_TOKENS). The
  // callers pass thinkingConfig.thinkingBudget=0, which only Gemini honours.
  model: process.env.GEMMA_MODEL ?? 'gemini-2.5-flash-lite',
  // Per-request timeout for the generateContent call.
  timeoutMs: parseInt(process.env.GEMMA_TIMEOUT_MS ?? '30000', 10),
  // Worker self-throttle: max scoring jobs started per minute (stay under the
  // free-tier RPM). Paired with concurrency in the processor's limiter.
  requestsPerMinute: parseInt(
    process.env.GEMMA_REQUESTS_PER_MINUTE ?? '15',
    10,
  ),
  // Jobs processed in parallel by the practice-scoring worker.
  workerConcurrency: parseInt(process.env.GEMMA_WORKER_CONCURRENCY ?? '1', 10),
  // Per-user submissions allowed per UTC day (quota guard for the shared key).
  dailyAttemptsPerUser: parseInt(
    process.env.GEMMA_DAILY_ATTEMPTS_PER_USER ?? '30',
    10,
  ),
}));
