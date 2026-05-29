import { registerAs } from '@nestjs/config';

function parseMinutesList(
  raw: string | undefined,
  fallback: number[],
): number[] {
  if (!raw) return fallback;
  const parsed = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  return parsed.length > 0 ? parsed : fallback;
}

export default registerAs('learn', () => ({
  hmacSecret:
    process.env.LEARN_HMAC_SECRET ?? 'dev-learn-hmac-secret-change-me',
  signatureTtlMs: parseInt(process.env.LEARN_SIGNATURE_TTL_MS ?? '1800000', 10),
  defaultSessionLimit: parseInt(
    process.env.LEARN_DEFAULT_SESSION_LIMIT ?? '15',
    10,
  ),
  maxSessionLimit: parseInt(process.env.LEARN_MAX_SESSION_LIMIT ?? '50', 10),
  // Intra-session steps (minutes) applied to all cards in step state:
  // brand-new cards, cards still in `learning` status, and graduated
  // cards that just lapsed. Default 1, 10 follows Anki — wrong → 1 min,
  // correct → 10 min, only then does the card graduate to the day-scale
  // SM-2 ladder.
  learningStepsMinutes: parseMinutesList(
    process.env.LEARN_LEARNING_STEPS_MINUTES,
    [1, 10],
  ),
  // Window for intra-session requeue: if next_review_at lands within this
  // many minutes of now, the answer response bakes a fresh signed question
  // so the client can re-show the card without a fresh /session call.
  requeueWindowMinutes: parseInt(
    process.env.LEARN_REQUEUE_WINDOW_MINUTES ?? '15',
    10,
  ),
}));
