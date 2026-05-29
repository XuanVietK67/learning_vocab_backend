import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { applySm2, SrsInputState } from '@/progress/srs';

const NOW = new Date('2026-05-29T00:00:00.000Z');
const STEPS = [1, 10];
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

function freshNewCard(): SrsInputState {
  return {
    status: ProgressStatus.NEW,
    repetitions: 0,
    easeFactor: 2.5,
    intervalDays: 0,
    learningStepIndex: 0,
  };
}

function graduatedReviewCard(): SrsInputState {
  return {
    status: ProgressStatus.REVIEW,
    repetitions: 4,
    easeFactor: 2.5,
    intervalDays: 16,
    learningStepIndex: null,
  };
}

describe('applySm2 — learning steps', () => {
  it('new card + correct → advances to step 1, scheduled at step[1] minutes', () => {
    const out = applySm2(freshNewCard(), 5, STEPS, NOW);
    expect(out.learningStepIndex).toBe(1);
    expect(out.status).toBe(ProgressStatus.LEARNING);
    expect(out.intervalDays).toBe(0);
    expect(out.nextReviewAt.getTime()).toBe(NOW.getTime() + 10 * MS_PER_MINUTE);
    // Ease still updates on every review.
    expect(out.easeFactor).toBeCloseTo(2.6, 5);
  });

  it('new card + wrong → restarts at step 0, scheduled at step[0] minutes', () => {
    const out = applySm2(freshNewCard(), 0, STEPS, NOW);
    expect(out.learningStepIndex).toBe(0);
    expect(out.nextReviewAt.getTime()).toBe(NOW.getTime() + 1 * MS_PER_MINUTE);
    // Ease penalty applied.
    expect(out.easeFactor).toBeCloseTo(1.7, 5);
  });

  it('final step + correct → graduates to 1-day SM-2 interval', () => {
    const onLastStep: SrsInputState = {
      ...freshNewCard(),
      learningStepIndex: STEPS.length - 1,
    };
    const out = applySm2(onLastStep, 5, STEPS, NOW);
    expect(out.learningStepIndex).toBeNull();
    expect(out.repetitions).toBe(1);
    expect(out.intervalDays).toBe(1);
    expect(out.status).toBe(ProgressStatus.LEARNING);
    expect(out.nextReviewAt.getTime()).toBe(NOW.getTime() + MS_PER_DAY);
  });

  it('mid step + wrong → drops back to step 0', () => {
    const midStep: SrsInputState = {
      ...freshNewCard(),
      learningStepIndex: 1,
    };
    const out = applySm2(midStep, 1, STEPS, NOW);
    expect(out.learningStepIndex).toBe(0);
    expect(out.nextReviewAt.getTime()).toBe(NOW.getTime() + 1 * MS_PER_MINUTE);
  });
});

describe('applySm2 — graduated card', () => {
  it('graduated + correct → classic SM-2 ladder (interval *= ease)', () => {
    const out = applySm2(graduatedReviewCard(), 5, STEPS, NOW);
    expect(out.learningStepIndex).toBeNull();
    expect(out.repetitions).toBe(5);
    // 16 * 2.5 base ease then ease-update bumps to 2.6 — interval uses
    // the prior ease value (before update would change the formula).
    // applySm2 updates ease BEFORE interval calc, so interval = 16 * 2.6 = 42.
    expect(out.intervalDays).toBe(Math.round(16 * 2.6));
    expect(out.nextReviewAt.getTime()).toBe(
      NOW.getTime() + out.intervalDays * MS_PER_DAY,
    );
    expect(out.status).toBe(ProgressStatus.REVIEW);
  });

  it('graduated + wrong → lapse drops into step 0 (relearning)', () => {
    const out = applySm2(graduatedReviewCard(), 1, STEPS, NOW);
    expect(out.learningStepIndex).toBe(0);
    expect(out.repetitions).toBe(0);
    expect(out.intervalDays).toBe(0);
    expect(out.status).toBe(ProgressStatus.LEARNING);
    expect(out.nextReviewAt.getTime()).toBe(NOW.getTime() + 1 * MS_PER_MINUTE);
    // Ease still penalised on the lapse.
    expect(out.easeFactor).toBeLessThan(2.5);
  });

  it('mastered card hitting 90-day interval keeps mastered status', () => {
    const nearMastered: SrsInputState = {
      status: ProgressStatus.REVIEW,
      repetitions: 5,
      easeFactor: 2.5,
      intervalDays: 50,
      learningStepIndex: null,
    };
    const out = applySm2(nearMastered, 5, STEPS, NOW);
    // 50 * 2.6 = 130 >= 90 → mastered
    expect(out.status).toBe(ProgressStatus.MASTERED);
  });
});
