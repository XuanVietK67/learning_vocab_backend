# Free practice without breaking spaced repetition

**Status:** proposed · **Owner:** learn module · **Created:** 2026-06-15

## Problem

After finishing a session, a user cannot immediately re-study the same words.
The picker only surfaces cards whose `next_review_at <= now`
([vocab-picker.service.ts](../../src/learn/vocab-picker.service.ts)), so a card
just reviewed is pushed into the future and disappears until its interval
elapses. A learner who *wants* more practice is told to wait. Bad UX.

Root cause: the picker conflates two concerns that should be independent.

| Concern | Question | Today |
|---|---|---|
| **Access** | "May I study this word right now?" | gated by `next_review_at <= now` |
| **Scheduling** | "Does this attempt move the SRS schedule?" | unconditional in `submitReview` |

## Principle

**Always allow practice. Only let an attempt move the SRS schedule when the
card is actually due.**

Why the schedule must stay gated: reviewing a card early gives almost no
scheduling signal — you recall it because it is *fresh*, not because the memory
is *durable*. Counting an early success would inflate the interval and defeat
the spacing effect. So we free the practice and keep the schedule honest. This
mirrors Anki's "filtered deck / do not reschedule".

## Design

### 1. Schedule decision is a function of the card's due-state, not the session

The scheduling gate lives entirely in
[`submitReview`](../../src/progress/progress.service.ts) and depends only on the
card's current state at submit time — **not** on any "is this a practice
session" flag carried from the client. This keeps it stateless and tamper-proof
(no signature/HMAC change needed in `submitAnswer`), and it does the right thing
even if a not-due card reaches submit through any path.

Define **early** precisely:

```ts
const isEarly =
  progress.learningStepIndex === null &&                 // graduated, day-scale
  progress.nextReviewAt.getTime() > now + toleranceMs;   // still in the future
```

- **Learning-step cards** (`learningStepIndex !== null`) are *meant* to come
  back within the session — the requeue window already relies on this
  ([learn.service.ts](../../src/learn/learn.service.ts)). They are never "early";
  always advance them.
- **NEW cards** default `next_review_at = now()`, so they are due → first review
  schedules them normally.
- `toleranceMs` is a small grace (config, default ~0–60s) so a card due in
  seconds doesn't feel blocked.

### 2. Early-attempt policy (asymmetric)

Early outcomes are **not** symmetric, because an early failure is real signal
(forgotten sooner than predicted) while an early success is noise.

| Early attempt | Schedule effect |
|---|---|
| **Correct** | No-op. Leave `next_review_at`, `status`, `repetitions`, `ease_factor` untouched. |
| **Wrong** | May **shorten** only — pull the review forward / drop to learning step 0. Never lengthen. |

One-line rule: **early answers can only hurt the schedule, never help it.**

- **MVP:** pure no-op on *both* outcomes (simplest, still correct).
- **Refinement (later):** shorten-on-fail. More faithful, more logic. Ship after MVP.

### 3. Surfacing practice — the picker change

Add a `practice: boolean` flag to
[`CreateSessionDto`](../../src/learn/dto/create-session.dto.ts) rather than a new
`LearnSessionMode`. Practice is a *modifier* on a content source, not a source
itself — the learner wants to grind *a specific deck / topic*.

- `practice = true` → the picker skips the `next_review_at <= now` filter and
  returns the user's enrolled words for that source (deck / topic), regardless of
  due-state. `freshVocabIds` still flows (auto-enroll new words as today).
- Valid with `deck` and `topic`. For `review` it is meaningless (review *is* the
  due queue) and for `daily` it is ambiguous — reject or ignore there (decision
  below).
- In practice mode the time-based empty reasons (`no_due_cards`) and `nextDueAt`
  ("come back later") no longer apply — an empty practice session means the
  source is genuinely exhausted, not that the user must wait.

### 4. Keep the stats honest

`submitReview` writes a `LearningActivity` row that drives the heatmap, the exact
streak, "reviewed today", and `becameMastered`
([learning-activity.entity.ts](../../src/progress/entities/learning-activity.entity.ts)),
plus `correctCount` / `incorrectCount` on the progress row. If practice flows
through unchanged, a user can farm their streak and dilute accuracy by
re-grinding one word.

Plan:

- Add an `is_practice` (boolean) column to `learning_activity`.
- A scheduled review → `is_practice = false`, full behaviour as today
  (`was_new` / `became_mastered` / accuracy counters all fire).
- An early/practice attempt → `is_practice = true`. It **counts toward the
  engagement heatmap** (engagement is good) but **never** toward SRS metrics:
  `was_new = false`, `became_mastered = false`, and the progress row's accuracy
  counters are not bumped.
- Stats queries that mean "real reviews" (e.g. `dueNow`, mastery transitions)
  filter `is_practice = false`; the heatmap counts all rows (or splits the two —
  decision below).

## Touch points

| File | Change |
|---|---|
| [vocab-picker.service.ts](../../src/learn/vocab-picker.service.ts) | practice path that ignores the due filter for deck/topic |
| [create-session.dto.ts](../../src/learn/dto/create-session.dto.ts) | `practice?: boolean` |
| [learn.service.ts](../../src/learn/learn.service.ts) | thread `practice` into `dispatchPicker`; suppress `nextDueAt`/time-based empty reason in practice |
| [progress.service.ts](../../src/progress/progress.service.ts) | due-gate in `submitReview`; early policy; `is_practice` on the activity insert |
| [learning-activity.entity.ts](../../src/progress/entities/learning-activity.entity.ts) | `is_practice` column |
| `src/database/migrations/` | add `is_practice` (default false, backfill existing rows false) |
| [docs/backend/api-endpoints.md](../../docs/backend/api-endpoints.md) + frontend per-feature doc | document the `practice` flag |

No change to the HMAC signer / `submitAnswer` signature payload.

## Open decisions (need your call)

1. **Does free practice count toward the streak/heatmap?**
   Recommend **yes**, flagged `is_practice = true` (engagement reward) but
   excluded from SRS metrics. Alternative: practice counts toward streak only on
   days the user also did ≥1 scheduled review (anti-farming).
2. **MVP early policy** — pure no-op both outcomes (recommended) vs shorten-on-fail now.
3. **Practice surface** — `practice` flag on deck/topic (recommended) vs a new
   `LearnSessionMode.PRACTICE`.
4. **Practice + `daily`/`review`** — reject with 400, or silently ignore the flag?

## Phasing

- **Phase 1 (MVP):** `practice` flag + picker path (deck/topic) · due-gate in
  `submitReview` with early = no-op both outcomes · `is_practice` column +
  migration · stats exclude practice from SRS metrics · docs.
- **Phase 2:** shorten-on-fail for early wrong answers.
- **Phase 3 (optional):** anti-farming rule for streak, practice accuracy counters.

---

# Implementation plan — Phase 1 (MVP)

Defaults taken for the four open decisions (override before coding if wrong):
**(1)** practice counts toward heatmap, flagged, excluded from SRS metrics ·
**(2)** early = no-op on both outcomes · **(3)** `practice` flag on deck/topic ·
**(4)** practice + `daily`/`review` → **400**.

Branch: `feat/free-practice-srs`. Ordered so each step compiles on its own.

### Step 1 — `learning_activity.is_practice` column + migration

[learning-activity.entity.ts](../../src/progress/entities/learning-activity.entity.ts):

```ts
// True when this row came from free practice (card not yet due). Counts toward
// the engagement heatmap but never toward SRS metrics (was_new / became_mastered
// stay false, accuracy counters untouched).
@Column({ name: 'is_practice', type: 'boolean', default: false })
isPractice!: boolean;
```

New migration `src/database/migrations/1782100000000-AddLearningActivityIsPractice.ts`
(model on [AddLearningStepIndex](../../src/database/migrations/1780500000000-AddLearningStepIndex.ts)):

```sql
-- up
ALTER TABLE "learning_activity"
  ADD COLUMN "is_practice" boolean NOT NULL DEFAULT false;
-- down
ALTER TABLE "learning_activity" DROP COLUMN "is_practice";
```

Existing rows backfill to `false` via the column default — all historical events
were scheduled reviews. No data migration needed.

### Step 2 — config: early tolerance

[learn.config.ts](../../src/config/learn.config.ts) — add:

```ts
// Grace window (seconds) before a future-due graduated card is treated as
// "early" (practice). Keeps a card due in seconds from feeling blocked.
earlyToleranceSeconds: parseInt(process.env.LEARN_EARLY_TOLERANCE_SECONDS ?? '0', 10),
```

### Step 3 — due-gate + early policy in `submitReview`

[progress.service.ts](../../src/progress/progress.service.ts) `submitReview`,
after loading `progress` and computing `now`, before `applySm2`:

```ts
const isEarly =
  progress.learningStepIndex === null &&
  progress.nextReviewAt.getTime() >
    now.getTime() + this.cfg.earlyToleranceSeconds * 1000;

if (isEarly) {
  // Early practice: grade for feedback, log engagement, but DO NOT touch the
  // SRS schedule, status, ease, repetitions, or accuracy counters. (Phase 2
  // will let an early *wrong* answer shorten next_review_at.)
  await this.dataSource.manager.insert(LearningActivity, {
    userId,
    vocabularyId: dto.vocabularyId,
    reviewedAt: now,
    quality: dto.quality,
    isCorrect: dto.quality >= 3,
    wasNew: false,
    becameMastered: false,
    isPractice: true,
  });
  return plainToInstance(ProgressResponseDto, progress, {
    excludeExtraneousValues: true,
  });
}
```

The existing scheduled-review path stays as-is but sets `isPractice: false` on
its `LearningActivity` insert.

> Requeue naturally no-ops for early cards: `buildRequeue` only fires when
> `nextReviewAt` is within `requeueWindowMinutes`, and an early card's is far
> out — no change needed in [learn.service.ts](../../src/learn/learn.service.ts).

### Step 4 — surface "not counted" to the client

Add an optional flag to the answer result so the UI can show "practice — not
counted". In [answer-result.dto.ts](../../src/learn/dto/answer-result.dto.ts) and
[progress-response.dto.ts](../../src/progress/dto/progress-response.dto.ts) add a
boolean (e.g. `counted` / `scheduled`); `submitReview` sets it `false` on the
early branch, `true` otherwise. (Decision: confirm field name in review.)

### Step 5 — `practice` flag on the picker

[create-session.dto.ts](../../src/learn/dto/create-session.dto.ts):

```ts
@IsOptional()
@Type(() => Boolean)
@IsBoolean()
practice?: boolean;
```

Reject `practice = true` with `mode = daily | review` (decision 4). Enforce in
[learn.service.ts](../../src/learn/learn.service.ts) `createSession` (BadRequest)
or via a `@ValidateIf`.

[vocab-picker.service.ts](../../src/learn/vocab-picker.service.ts) — thread
`practice` into `pickByDeck` / `pickByTopic`. When `practice` is true, replace
the `findDueIdsInDeck` / `findDueIdsInTopic` call with a variant that drops the
`p.next_review_at <= now` predicate (keeps the deck/topic join, the user filter,
and `ORDER BY next_review_at ASC` so most-overdue-first ordering still holds).
`freshVocabIds` and auto-enroll are unchanged.

[learn.service.ts](../../src/learn/learn.service.ts) `dispatchPicker` — pass
`dto.practice` through. In practice mode, suppress the time-based empty-reason /
`nextDueAt` path (an empty practice session means "source exhausted", not
"wait") — i.e. don't call `resolveNextDueAt` when `dto.practice`.

### Step 6 — stats stay honest

[progress.service.ts](../../src/progress/progress.service.ts) — audit reads of
`learning_activity`:
- `getActivity` (heatmap): keep counting all rows **or** add a split — decide.
  Default: count all (practice included), since engagement is the point.
- Any query meaning "real reviews" / streak that must exclude practice: add
  `AND is_practice = false`. (`computeStreak`, `countReviewedToday` — confirm
  desired behaviour; default keeps practice in the streak per decision 1.)
- `was_new` / `became_mastered` already only set on the scheduled path → mastery
  and new-words metrics are automatically practice-free.

### Step 7 — tests

- [srs.spec.ts](../../src/progress/srs.spec.ts) is unaffected (pure SM-2).
- Add `submitReview` unit/e2e cases: (a) due card → schedules + `isPractice=false`;
  (b) early graduated card correct → schedule unchanged + `isPractice=true` row;
  (c) early graduated card wrong → schedule unchanged (Phase 1); (d) learning-step
  card → always advances regardless of `next_review_at`.
- Picker: `practice=true` deck/topic returns not-due enrolled words; `practice` +
  `daily`/`review` → 400.

### Step 8 — docs (same PR, per project rules)

- [docs/backend/api-endpoints.md](../../docs/backend/api-endpoints.md): note the
  `practice` flag on the create-session row.
- New per-feature frontend doc `docs/frontend/learn_practice_mode.md` (request
  with `practice: true`, that early attempts return `counted: false` and don't
  move the schedule), linked from
  [frontend_handoff.md](../../docs/frontend/frontend_handoff.md).

### Verification

`npm run build` + `npm run lint` (+ `npm test` for the new specs). Manual smoke
left to you: start a deck session with `practice: true`, answer a not-due card,
confirm `next_review_at` is unchanged and a `is_practice=true` activity row
appears.
```
