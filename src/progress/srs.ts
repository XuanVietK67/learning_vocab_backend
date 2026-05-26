import { ProgressStatus } from '@/progress/entities/progress-status.enum';

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

export interface SrsInputState {
  status: ProgressStatus;
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
}

export interface SrsOutputState {
  status: ProgressStatus;
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  nextReviewAt: Date;
}

const MASTERED_INTERVAL_DAYS = 90;
const MIN_EASE_FACTOR = 1.3;
const MS_PER_DAY = 86_400_000;

// SM-2 (SuperMemo 2). quality 0-5 where 3+ counts as a correct recall.
export function applySm2(
  state: SrsInputState,
  quality: ReviewQuality,
  now: Date = new Date(),
): SrsOutputState {
  let { repetitions, easeFactor, intervalDays } = state;

  if (quality < 3) {
    repetitions = 0;
    intervalDays = 1;
  } else {
    if (repetitions === 0) intervalDays = 1;
    else if (repetitions === 1) intervalDays = 6;
    else intervalDays = Math.round(intervalDays * easeFactor);
    repetitions += 1;
  }

  // SM-2 ease update, applied every review and clamped at 1.3.
  easeFactor = Math.max(
    MIN_EASE_FACTOR,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );

  const nextReviewAt = new Date(now.getTime() + intervalDays * MS_PER_DAY);
  return {
    status: inferStatus(repetitions, intervalDays),
    repetitions,
    easeFactor,
    intervalDays,
    nextReviewAt,
  };
}

function inferStatus(
  repetitions: number,
  intervalDays: number,
): ProgressStatus {
  if (intervalDays >= MASTERED_INTERVAL_DAYS) return ProgressStatus.MASTERED;
  if (repetitions >= 3) return ProgressStatus.REVIEW;
  return ProgressStatus.LEARNING;
}
