# Plan — Community leaderboard (two boards)

**Status:** Planned (not yet implemented).
**Feature:** A community ranking of top learners. Two boards:
1. **Words mastered** — all-time, by count of words reaching `mastered`. The stable, "depth" board.
2. **New words this week** — momentum board; resets weekly so there's always a fresh race.

Depends on the activity log from [learning_activity_heatmap_plan.md](learning_activity_heatmap_plan.md) for the windowed board. The all-time board needs **no** new storage.

---

## 1. Data sources

| Board | Source | Query shape |
|---|---|---|
| `words_mastered` (all-time) | existing [user_word_progress](../../src/progress/entities/user-word-progress.entity.ts) | `COUNT(*) FILTER (WHERE status='mastered') GROUP BY user_id` |
| `new_words` (week/month/all) | `learning_activity` (new table) | `COUNT(*) WHERE was_new AND reviewed_at >= :periodStart GROUP BY user_id` |

The all-time mastered board works the day this ships. The new-words board produces meaningful numbers only after the activity log has accumulated data (so ship mastered first, enable new-words once the log is live — see build order).

## 2. API — `GET /v1/leaderboard`

Single endpoint, parametrized. JWT required (so we can also return the **caller's own rank**, even when outside the top N).

- Query:
  - `metric` = `words_mastered` (default) | `new_words`.
  - `window` = `all` | `week` | `month`. For `words_mastered`, only `all` is supported in v1 (others → 400 or coerced to `all`). For `new_words`, default `week`.
  - `limit` = default `50`, max `100`.
- `week` window = current ISO week start (Mon 00:00 UTC) → now. `month` = first of the current month UTC → now. Define windows in **UTC** in v1 for simplicity; revisit per-user tz if needed.

Response shape, examples, and errors: see the frontend doc [community_leaderboard.md](../frontend/community_leaderboard.md). Core shape:

```json
{
  "metric": "new_words",
  "window": "week",
  "periodStart": "2026-06-08T00:00:00.000Z",
  "periodEnd": "2026-06-10T09:00:00.000Z",
  "limit": 50,
  "data": [
    { "rank": 1, "userId": "…", "username": "alice_99", "avatarUrl": "…", "value": 320 }
  ],
  "me": { "rank": 87, "value": 14 }
}
```

`me` is always present: the caller's `{ rank, value }`, or `{ rank: null, value: 0 }` if they have no qualifying activity / are opted out.

## 3. Ranking semantics

- **Eligibility:** only `role = 'user'` and `is_active = true`. Admins are excluded from the boards (they're not learners).
- **Zero values excluded** from `data` (no point listing users with 0 mastered / 0 new words), but the caller still sees their own `me.value: 0`.
- **Tie-break:** deterministic — same `value` ordered by `username ASC`. Ranks are **sequential** (1,2,3 …), not shared, to keep the list and any future pagination stable.
- **`me` rank** computed with `COUNT(*) WHERE value > my_value` + 1 over the eligible set (excluding opted-out users), so it's consistent with the displayed board.

## 4. Privacy

Boards expose `username` + `avatarUrl` publicly to other signed-in users. Add an opt-out:

- New column `users.leaderboard_opt_out boolean NOT NULL DEFAULT false`.
- Surfaced as an editable field on `PATCH /v1/users/:id` (the existing self-profile update).
- Opted-out users are excluded from `data` and from everyone's rank denominator, **but still see their own `me`**.

Default-in keeps the board populated; the toggle covers privacy-conscious users. (If we'd rather not expand the user table in v1, ship without opt-out and add it in a fast follow — note the decision in the PR.)

## 5. Performance / caching

- v1 (thesis scale): compute live. The mastered query is covered by the existing `IDX_user_word_progress_user_status`; the new-words query by `(user_id, reviewed_at)` (+ optional partial `WHERE was_new`).
- At scale: cache each `(metric, window)` board in memory/Redis with a short TTL (e.g. 60–120s) and compute `me` live (cheap, single aggregate). Optionally a periodic materialized snapshot. Don't recompute the full board per request under load.

## 6. Module structure

New `LeaderboardModule` — its own surface, separate from progress:

- `src/leaderboard/leaderboard.controller.ts` — `GET /v1/leaderboard`, `@Controller({ path: 'leaderboard', version: '1' })`.
- `src/leaderboard/leaderboard.service.ts` — the two aggregate queries + `me` rank + cache.
- `src/leaderboard/dto/leaderboard-query.dto.ts`, `leaderboard-response.dto.ts`.
- Reads `UserWordProgress` and `LearningActivity` repos (import their feature modules / register entities).

## 7. Migration

- `add_leaderboard_opt_out_to_users` — adds the boolean column (only if opt-out is in v1).
- No migration for the boards themselves — they're read-only aggregates over existing/forthcoming tables.

## 8. Testing

- Service: mastered board ranks by mastered count desc, excludes admins/inactive/opted-out, tie-breaks by username, ranks sequential.
- Service: new-words board respects `week`/`month`/`all` window boundaries (UTC), counts only `was_new`.
- Service: `me` returned for a caller outside the top N; `{ rank: null, value: 0 }` for a caller with no activity; opted-out caller sees own `me` but is absent from `data`.
- Controller: `limit` clamp (max 100); invalid `metric`/`window` → 400; `words_mastered` + `window!=all` handling.
- e2e: two seeded users with known counts produce the expected order and `me`.

## 9. Build order

1. **All-time `words_mastered` board** — works off existing data, ship immediately.
2. `users.leaderboard_opt_out` column + wire into `PATCH /v1/users/:id` and eligibility.
3. **`new_words` board** — enable once `learning_activity` (the heatmap plan) is live and accumulating.
4. Caching layer (only if needed).
5. Update [api-endpoints.md](../backend/api-endpoints.md) (new `## Leaderboard — /v1/leaderboard` section) and the frontend index — **at implementation time**, per [CLAUDE.md](../../CLAUDE.md).

## 10. Files to touch

- `src/leaderboard/` — module, controller, service, DTOs (all new).
- `src/database/migrations/<ts>-AddLeaderboardOptOutToUsers.ts` (new, if opt-out in v1).
- [src/users/entities/user.entity.ts](../../src/users/entities/user.entity.ts) — `leaderboardOptOut` column.
- [src/users/users.controller.ts](../../src/users/users.controller.ts) + update DTO — accept the toggle on self-update.
- [src/app.module.ts](../../src/app.module.ts) — register `LeaderboardModule`.
- Docs: [api-endpoints.md](../backend/api-endpoints.md), [community_leaderboard.md](../frontend/community_leaderboard.md).

## 11. Open questions

- Opt-out in v1, or fast follow?
- Surface the caller's avatar/medal styling for top 3 (FE), and do we want a `GET /v1/users/:id` mini-profile reachable from a row (future)?
- `words_mastered` windowed variants (week/month) later via `learning_activity.became_mastered` — wanted, or all-time only?
