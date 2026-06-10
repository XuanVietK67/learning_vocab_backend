# Community leaderboard

`GET /v1/leaderboard` — **JWT required.** Returns a ranked list of top learners plus the caller's own rank.

> **Status: planned / not yet implemented.** This documents the agreed contract ahead of the backend work tracked in [../plans/community_leaderboard_plan.md](../plans/community_leaderboard_plan.md). Don't wire the real call until the endpoint ships.

---

## What it's for

Two boards the UI can toggle between:

- **Words mastered** (`metric=words_mastered`, all-time) — total words the user has driven to `mastered`. The stable "depth" board.
- **New words this week** (`metric=new_words`, `window=week`) — words studied for the first time in the current week. Resets weekly for a fresh race.

Each response also returns **`me`** — the caller's rank and value — so you can pin a "your position" row even when they're outside the visible top N.

## Request

```http
GET /v1/leaderboard?metric=new_words&window=week&limit=50
Authorization: Bearer <accessToken>
```

| Query param | Required? | Type | Rules / default |
|---|---|---|---|
| `metric` | no | enum | `words_mastered` (default) \| `new_words`. |
| `window` | no | enum | `all` \| `week` \| `month`. For `words_mastered`: only `all` (others → `400`). For `new_words`: default `week`. |
| `limit` | no | int | Default `50`, max `100`. |

Window boundaries are UTC: `week` = current ISO week (Mon 00:00 UTC → now), `month` = 1st of the month UTC → now.

## Response `200`

```json
{
  "metric": "new_words",
  "window": "week",
  "periodStart": "2026-06-08T00:00:00.000Z",
  "periodEnd": "2026-06-10T09:00:00.000Z",
  "limit": 50,
  "data": [
    { "rank": 1, "userId": "9f1a…", "username": "alice_99", "avatarUrl": "https://…/a.png", "value": 320 },
    { "rank": 2, "userId": "3c2b…", "username": "bao_le",   "avatarUrl": null,             "value": 295 },
    { "rank": 3, "userId": "7d4e…", "username": "minh",     "avatarUrl": null,             "value": 270 }
  ],
  "me": { "rank": 87, "value": 14 }
}
```

| Field | Type | Meaning |
|---|---|---|
| `metric` / `window` | string | Echoes the resolved query. |
| `periodStart` / `periodEnd` | ISO datetime | The window being measured (`periodStart` is null for `window=all`). |
| `limit` | int | Echoes the page size. |
| `data[].rank` | int | 1-based, sequential (ties broken by username, no shared ranks). |
| `data[].userId` | uuid | The ranked user. |
| `data[].username` | string \| null | Display name. |
| `data[].avatarUrl` | string \| null | Avatar, may be null. |
| `data[].value` | int | The metric count (mastered words, or new words in window). |
| `me` | object | The **caller's** standing: `{ rank, value }`. `rank` is `null` and `value` `0` when the caller has no qualifying activity or has opted out. |

Notes:
- `data` lists only eligible users with `value > 0`: real learners (`role=user`, active), excluding anyone opted out of the leaderboard.
- `me` is always present even if the caller isn't in `data` (outside top N, or opted out).

## Rendering notes

- **Board toggle** = the `metric`/`window` pair. Suggested tabs: "Mastered (all-time)" → `words_mastered&window=all`; "This week" → `new_words&window=week`.
- **Top 3** typically get medal styling; render the rest as a plain ranked list.
- **Pin `me`.** If `me.rank` is beyond `limit`, show a sticky row at the bottom: `#{me.rank} · You · {me.value}`. If `me.rank` is null, show "Study a word to join the board."
- **Refresh cadence.** Values update as people study; the server may cache for ~1–2 min, so don't poll aggressively — refetch on tab focus / pull-to-refresh.
- **Privacy toggle (planned).** Users can opt out of appearing on the board via their profile settings (`PATCH /v1/users/:id`, field `leaderboardOptOut`). Opted-out users still see their own `me` but are absent from everyone's `data`. Surface this as an "Appear on leaderboard" switch in settings.

## Errors

| Status | When |
|---|---|
| `400` | Invalid `metric`/`window` combination (e.g. `words_mastered` + `window=week`), or `limit` out of range. |
| `401` | Missing / invalid JWT. |

## Empty state

Early on, the weekly board may have few entries. Render whatever `data` returns; if empty, show "No one's studied yet this week — be the first." Always still render the `me` row.
