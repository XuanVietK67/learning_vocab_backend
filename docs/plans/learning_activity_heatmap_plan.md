# Plan — Learning activity log + contribution heatmap

**Status:** Shipped — `learning_activity` log + write hook in `submitReview`, `GET /v1/me/activity`, the streak repoint, and the approximate backfill are all implemented. This unblocks the `new_words` board in [community_leaderboard_plan.md](community_leaderboard_plan.md) (currently 501).
**Feature:** A GitHub-style per-day activity heatmap for the authenticated user ("which days did I study, and how many words per day"), plus the append-only event log that powers it.

This is the **keystone** of the two community/analytics features. The same `learning_activity` log also feeds the windowed (weekly) leaderboard in [community_leaderboard_plan.md](community_leaderboard_plan.md) and lets us replace the lossy streak calc.

---

## 1. Why a new table is required

Today there is **no per-event history**. [user_word_progress](../../src/progress/entities/user-word-progress.entity.ts) keeps only `last_reviewed_at` — the *most recent* review per word. The current streak in [progress.service.ts](../../src/progress/progress.service.ts) (`computeStreak`, ~L295) derives "active days" from `DISTINCT (last_reviewed_at)::date`, which is **lossy**: re-reviewing a word overwrites its earlier date, so a day where you only re-drilled already-seen words can disappear.

You cannot answer "how many words did I review on 2026-03-03?" from the current schema. A heatmap needs counts per day across a year → we must persist one row per review event.

## 2. Data model — `learning_activity`

New entity `LearningActivity` → table `learning_activity`. Lives in the progress module: `src/progress/entities/learning-activity.entity.ts`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid NOT NULL | FK → `users`, `onDelete: CASCADE` (deleting a user removes their activity). |
| `vocabulary_id` | uuid **NULL** | FK → `vocabularies`, `onDelete: SET NULL`. **Nullable on purpose** — deleting a word must *not* erase the historical day-count, so we null the link instead of cascading the row away. |
| `reviewed_at` | timestamptz NOT NULL | The actual event time (the `now` used in the review). Day-bucketing key. |
| `quality` | smallint NOT NULL | SM-2 grade 0–5. |
| `is_correct` | boolean NOT NULL | `quality >= 3`. |
| `was_new` | boolean NOT NULL | `true` when this was the word's **first-ever** graded review (`lastReviewedAt === null` before the update). Drives the heatmap's `newWords` metric and the "new words this week" board. |
| `became_mastered` | boolean NOT NULL | `true` when this review transitioned status into `mastered`. Lets us build a mastered-over-time view without scanning progress. |
| `created_at` | timestamptz | `CreateDateColumn`. |

**Indexes**
- `IDX_learning_activity_user_reviewed (user_id, reviewed_at)` — range scan for the heatmap + streak.
- Optional partial `IDX_learning_activity_user_new (user_id, reviewed_at) WHERE was_new` — speeds the weekly new-words leaderboard. Add only if the windowed board is slow.

## 3. Write path (single insertion point)

Insert one `learning_activity` row inside [`ProgressService.submitReview`](../../src/progress/progress.service.ts#L155), atomically with the progress save. Because the learn flow's final step calls `submitReview` ([learn.service.ts:218](../../src/learn/learn.service.ts#L218)), this **one** change covers both `POST /v1/me/progress/review` and `POST /v1/me/learn/answer`.

Capture the signals **before** mutating `progress`:

```
const wasNew = progress.lastReviewedAt === null;          // first-ever review
const prevStatus = progress.status;
// … applySm2 … set fields … progress.lastReviewedAt = now …
const becameMastered =
  prevStatus !== ProgressStatus.MASTERED &&
  next.status === ProgressStatus.MASTERED;
```

Wrap the progress `save` + activity `insert` in `manager.transaction(...)` so a review never half-records. The activity insert is fire-and-forget from the client's perspective (no response shape change to `/review`).

> Definition choices to lock in:
> - **"New word learned"** = first graded review of the word (`was_new`). This is what the heatmap's `newWords` counts and what the weekly leaderboard ranks.
> - A **"contribution"/active day** = ≥1 `learning_activity` row that day (any review), matching GitHub's "did something" semantics.

## 4. Backfill (optional migration step)

Existing users have no history, so a fresh `learning_activity` would start the heatmap (and the improved streak) near-empty. Optional one-time backfill: insert one synthetic row per existing `user_word_progress` with `last_reviewed_at IS NOT NULL` →
`reviewed_at = last_reviewed_at`, `was_new = (repetitions <= 1)` (best-effort), `became_mastered = (status = 'mastered')`, `quality = 3`. This gives a rough starting heatmap without claiming per-day precision we never had. Flag clearly as approximate; skip if a clean start is preferred.

## 5. Read API — `GET /v1/me/activity`

New endpoint (progress module). JWT required. Self only in v1.

- Query: `from` (date, default `to − 364d`), `to` (date, default today), `tz` (IANA, default `UTC`).
- Day bucketing: `(reviewed_at AT TIME ZONE :tz)::date`, so "which day" respects the user's local midnight (GitHub buckets by the viewer's local day). Frontend passes the device timezone.
- Returns only **active** days; client fills the empty grid. Include totals + `maxReviews` so the client can scale intensity buckets.

Response shape, errors, and rendering notes: see the frontend doc [me_activity_heatmap.md](../frontend/me_activity_heatmap.md).

**Future extension (out of scope v1):** a public `GET /v1/users/:id/activity` for profile pages reachable from the leaderboard — gated by the same opt-out flag introduced in the leaderboard plan.

## 6. Streak cleanup (recommended, same PR)

Once the log exists, repoint `computeStreak` to `SELECT DISTINCT (reviewed_at AT TIME ZONE tz)::date FROM learning_activity` for an **exact** streak. Keep the same "today or yesterday, else broken" rule. This removes the lossy behaviour and keeps streak consistent with the heatmap (both read the same source). Without backfill, in-progress streaks reset — call that out in the PR.

## 7. Edge cases

- **Multiple reviews of the same word same day** → multiple rows; `reviews` count reflects effort, `was_new` is true on at most one of them (the first ever).
- **Requeued cards** (learn requeue window): each graded final step is its own event — expected.
- **Non-final learn steps** grade for feedback only and must **not** write activity (they don't call `submitReview`, so this is already correct).
- **Word deleted later** → `vocabulary_id` nulled, day-count preserved.
- **tz** invalid string → 400 (validate against a known IANA set or let Postgres error and map to 400).

## 8. Testing

- Unit: `submitReview` inserts exactly one row with correct `was_new` / `became_mastered` / `is_correct` for: first review, repeat review, mastering review, failed review.
- Unit: learn-answer final step produces an activity row; non-final steps produce none.
- Service: `getActivity` groups by local day under a non-UTC `tz`, respects `from/to`, returns totals + `maxReviews`, omits empty days.
- Migration: table + indexes created; optional backfill count matches progress rows with `last_reviewed_at`.

## 9. Build order

1. Entity + migration (`create_learning_activity`).
2. Write hook in `submitReview` (transactional).
3. `GET /v1/me/activity` (service + controller + DTO).
4. Repoint `computeStreak` (optional but recommended).
5. Optional backfill migration.
6. Update [api-endpoints.md](../backend/api-endpoints.md) (add the `/v1/me/activity` row) and the frontend index — **at implementation time**, per [CLAUDE.md](../../CLAUDE.md).

## 10. Files to touch

- `src/progress/entities/learning-activity.entity.ts` (new)
- `src/database/migrations/<ts>-CreateLearningActivity.ts` (new)
- [src/progress/progress.service.ts](../../src/progress/progress.service.ts) — write hook + streak repoint + `getActivity`
- [src/progress/progress.controller.ts](../../src/progress/progress.controller.ts) — `GET /v1/me/activity`
- `src/progress/dto/activity-response.dto.ts` + `activity-query.dto.ts` (new)
- [src/progress/progress.module.ts](../../src/progress/progress.module.ts) — register the new entity repo
- Docs: [api-endpoints.md](../backend/api-endpoints.md), [me_activity_heatmap.md](../frontend/me_activity_heatmap.md)

## 11. Open questions

- Backfill: approximate from `last_reviewed_at`, or start clean?
- Heatmap headline metric (the "476 contributions" label): total reviews or total new words? (Expose both; let FE choose.)
- Intensity buckets: fixed (GitHub-style 1–3 / 4–6 / 7–9 / 10+) or quartiles off `maxReviews`?
