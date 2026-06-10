# Activity heatmap (contribution calendar)

`GET /v1/me/activity` — **JWT required.** Returns the authenticated user's per-day study activity for a date range, for rendering a GitHub-style contribution grid.

> **Status: live.** Implemented per [../plans/learning_activity_heatmap_plan.md](../plans/learning_activity_heatmap_plan.md). Activity is logged from the day this shipped; existing users got an approximate backfill from their last review per word, so early calendars may look sparse.

---

## What it's for

A year-view heatmap of "which days did I study, and how much": one cell per day, colour intensity by number of reviews, plus a per-day count of **new words learned**. Same UX as the GitHub contributions calendar in the product brief.

## Request

```http
GET /v1/me/activity?from=2025-06-11&to=2026-06-10&tz=Asia/Ho_Chi_Minh
Authorization: Bearer <accessToken>
```

| Query param | Required? | Type | Rules / default |
|---|---|---|---|
| `from` | no | date `YYYY-MM-DD` | Start of range (inclusive). Default `to − 364 days` (a 53-week grid). |
| `to` | no | date `YYYY-MM-DD` | End of range (inclusive). Default **today**. Must be ≥ `from`. |
| `tz` | no | IANA timezone | Day-bucketing timezone, e.g. `Asia/Ho_Chi_Minh`. Default `UTC`. **Pass the device timezone** so a cell matches the user's local day. |

- Range is capped server-side (e.g. ≤ 366 days). A wider range → `400`.

## Response `200`

Only **active** days are returned — the client fills the empty cells of the grid itself.

```json
{
  "from": "2025-06-11",
  "to": "2026-06-10",
  "timezone": "Asia/Ho_Chi_Minh",
  "totalReviews": 1840,
  "totalNewWords": 476,
  "activeDays": 211,
  "maxReviews": 92,
  "days": [
    { "date": "2026-01-14", "reviews": 12, "newWords": 3 },
    { "date": "2026-01-15", "reviews": 4,  "newWords": 0 },
    { "date": "2026-03-21", "reviews": 92, "newWords": 18 }
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `from` / `to` | date | Echoes the resolved range. |
| `timezone` | string | The tz used for day bucketing. |
| `totalReviews` | int | All review events in range (the "N contributions in the last year" headline). |
| `totalNewWords` | int | Words studied for the **first time** in range. |
| `activeDays` | int | Number of days with ≥1 review. |
| `maxReviews` | int | Highest single-day `reviews` in range — use it to scale colour buckets. |
| `days[].date` | date | Local day (per `tz`). |
| `days[].reviews` | int | Review events that day → **cell intensity**. |
| `days[].newWords` | int | First-time words that day → optional secondary metric / tooltip. |

## Rendering notes

- **Build the grid client-side.** Lay out weeks as columns (Sun/Mon start), days as rows, from `from` to `to`. Index `days[]` into a `Map<date, {reviews,newWords}>`; any date not in the map is an empty (0) cell.
- **Intensity buckets.** Either fixed GitHub-style thresholds on `reviews` — `0`, `1–3`, `4–6`, `7–9`, `10+` — or quartiles derived from `maxReviews`. Keep 4–5 levels.
- **Tooltip:** `"{reviews} reviews · {newWords} new words on {date}"`. Empty day → `"No activity on {date}"`.
- **Headline label:** `"{totalReviews} reviews in the last year"` (or swap to `totalNewWords` — both are provided).
- **Timezone matters.** Always send the device `tz`; otherwise a late-night session lands on the wrong day versus what the user expects. If the user changes timezone, re-fetch.
- **Streak** is a separate call ([GET /v1/me/stats](../backend/api-endpoints.md#progress) → `streakDays`); it reads the same `learning_activity` source, so the heatmap's lit days and the streak count agree. (Streak buckets by UTC day; the heatmap buckets by your `tz` — they can differ by one day right around local midnight.)

## Errors

| Status | When |
|---|---|
| `400` | `to < from`, range exceeds the cap, or `tz` is not a valid IANA name. |
| `401` | Missing / invalid JWT. |

## Empty state

A user who has never studied returns `totalReviews: 0`, `activeDays: 0`, `days: []`. Render the full empty grid with a "Start learning to light up your calendar" prompt.
