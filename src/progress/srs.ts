import { ProgressStatus } from '@/progress/entities/progress-status.enum';

export type ReviewQuality = 0 | 1 | 2 | 3 | 4 | 5;

export interface SrsInputState {
  status: ProgressStatus;
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  learningStepIndex: number | null;
}

export interface SrsOutputState {
  status: ProgressStatus;
  repetitions: number;
  easeFactor: number;
  intervalDays: number;
  nextReviewAt: Date;
  learningStepIndex: number | null;
}

const MASTERED_INTERVAL_DAYS = 90;
const MIN_EASE_FACTOR = 1.3;
const MS_PER_DAY = 86_400_000;
const MS_PER_MINUTE = 60_000;

// SM-2 (SuperMemo 2) extended with Anki-style learning steps.
//
// Cards in step state (`learningStepIndex !== null`) use minute-scale
// intervals taken from `learningStepsMinutes`. A correct answer advances
// one step; past the final step the card "graduates" to the day-scale
// ladder (1d, 6d, then interval * easeFactor). A wrong answer resets to
// step 0. Graduated cards that miss a review drop back into step 0,
// re-using the same step list (one list serves new + lapses in v1).
//
// `easeFactor` updates on every review regardless of step state, same
// formula as classic SM-2.
export function applySm2(
  state: SrsInputState,
  quality: ReviewQuality,
  learningStepsMinutes: number[],
  now: Date = new Date(),
): SrsOutputState {
  let { repetitions, easeFactor, intervalDays } = state;
  const { learningStepIndex } = state;

  easeFactor = updateEaseFactor(easeFactor, quality);

  if (learningStepIndex !== null) {
    return applyStepState(
      { repetitions, easeFactor, intervalDays, learningStepIndex },
      quality,
      learningStepsMinutes,
      now,
    );
  }

  // Already graduated → classic SM-2. A miss drops the card into step 0
  // so it comes back within the session, not tomorrow.
  if (quality < 3) {
    return {
      status: ProgressStatus.LEARNING,
      repetitions: 0,
      easeFactor,
      intervalDays: 0,
      nextReviewAt: new Date(
        now.getTime() + learningStepsMinutes[0] * MS_PER_MINUTE,
      ),
      learningStepIndex: 0,
    };
  }

  if (repetitions === 0) intervalDays = 1;
  else if (repetitions === 1) intervalDays = 6;
  else intervalDays = Math.round(intervalDays * easeFactor);
  repetitions += 1;

  return {
    status: inferStatus(repetitions, intervalDays),
    repetitions,
    easeFactor,
    intervalDays,
    nextReviewAt: new Date(now.getTime() + intervalDays * MS_PER_DAY),
    learningStepIndex: null,
  };
}

function applyStepState(
  state: {
    repetitions: number;
    easeFactor: number;
    intervalDays: number;
    learningStepIndex: number;
  },
  quality: ReviewQuality,
  steps: number[],
  now: Date,
): SrsOutputState {
  const { repetitions, easeFactor } = state;
  let { learningStepIndex } = state;

  if (quality < 3) {
    learningStepIndex = 0;
    return {
      status: ProgressStatus.LEARNING,
      repetitions,
      easeFactor,
      intervalDays: 0,
      nextReviewAt: new Date(now.getTime() + steps[0] * MS_PER_MINUTE),
      learningStepIndex,
    };
  }

  const nextStep = learningStepIndex + 1;
  if (nextStep < steps.length) {
    return {
      status: ProgressStatus.LEARNING,
      repetitions,
      easeFactor,
      intervalDays: 0,
      nextReviewAt: new Date(now.getTime() + steps[nextStep] * MS_PER_MINUTE),
      learningStepIndex: nextStep,
    };
  }

  // Graduate out of steps into the day-scale ladder.
  const graduatedReps = 1;
  const graduatedInterval = 1;
  return {
    status: inferStatus(graduatedReps, graduatedInterval),
    repetitions: graduatedReps,
    easeFactor,
    intervalDays: graduatedInterval,
    nextReviewAt: new Date(now.getTime() + graduatedInterval * MS_PER_DAY),
    learningStepIndex: null,
  };
}

function updateEaseFactor(easeFactor: number, quality: ReviewQuality): number {
  return Math.max(
    MIN_EASE_FACTOR,
    easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)),
  );
}

function inferStatus(
  repetitions: number,
  intervalDays: number,
): ProgressStatus {
  if (intervalDays >= MASTERED_INTERVAL_DAYS) return ProgressStatus.MASTERED;
  if (repetitions >= 3) return ProgressStatus.REVIEW;
  return ProgressStatus.LEARNING;
}
