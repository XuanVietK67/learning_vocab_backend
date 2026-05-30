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

// Parses the two ascending exercise-tier thresholds "t0,t1". Falls back if
// the input is malformed, non-ascending, or not exactly two positive ints.
function parseTierThresholds(
  raw: string | undefined,
  fallback: [number, number],
): [number, number] {
  if (!raw) return fallback;
  const parsed = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (parsed.length !== 2 || parsed[0] >= parsed[1]) return fallback;
  return [parsed[0], parsed[1]];
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
  // Successful-exposure thresholds [t0, t1] that unlock harder exercise
  // tiers, decoupled from SRS status. correctCount < t0 → tier 0
  // (recognition); t0 ≤ cc < t1 → tier 1 (recall, adds cloze typing);
  // cc ≥ t1 → tier 2 (production, adds sentence build + sense
  // disambiguation). Default [2, 4]: typing after 2 correct, production
  // after 4. Data feasibility (translations, senses, audio) still gates
  // each type on top of the tier.
  exerciseTierThresholds: parseTierThresholds(
    process.env.LEARN_EXERCISE_TIER_THRESHOLDS,
    [2, 4],
  ),
}));
