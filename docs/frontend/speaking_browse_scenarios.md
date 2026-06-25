# Speaking Room — Browse scenarios (frontend guide)

The learner-facing catalogue for the **Speaking Room**: published scenarios shown
as cards the learner picks before starting a live practice session.

- **Endpoints:** `GET /v1/speaking/scenarios` · `GET /v1/speaking/scenarios/:id`
- **Auth:** `Authorization: Bearer <accessToken>` (any logged-in user)
- Canonical contract: [api-endpoints.md](../backend/api-endpoints.md) · the session itself: [speaking_practice_session.md](speaking_practice_session.md) · design: [speaking_room_phase2_user_practice.md](../plans/speaking_room_phase2_user_practice.md)

---

## List — `GET /v1/speaking/scenarios`

Returns **published** scenarios only (drafts/retired are never exposed here).

### Query params

| Param | Required | Type | Rules |
|---|---|---|---|
| `topic` | — | string | lowercase slug `^[a-z0-9-]+$`, 1–64 chars |
| `cefrLevel` | — | enum | `A1`,`A2`,`B1`,`B2`,`C1`,`C2` |
| `page` | — | int | ≥ 1, default 1 |
| `limit` | — | int | 1–100, default 20 |

If the learner has a CEFR level on their profile and does **not** pin `cefrLevel`,
results are ordered so scenarios at their level come first, then `any`-level ones,
then the rest — a lightweight recommendation. Pinning `cefrLevel` filters strictly.

### Response (200)

```jsonc
{
  "data": [
    {
      "id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
      "title": "Ordering at a café",
      "topic": "food",
      "cefrLevel": "B1",                 // or null = any level
      "setting": "A busy café at lunchtime.",
      "aiRole": "barista",
      "userRole": "customer",
      "goal": "Order a drink and a snack, and ask for the price.",
      "openingLine": "Hi there! What can I get for you today?",
      "seedPhrases": ["I'd like...", "How much is...", "for here or to go"],
      "estTurns": 8,                     // or null
      "introVideoUrl": null              // MP4 cutscene URL when present (later)
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 1
}
```

Admin-only fields (`status`, `version`, `createdBy`, `introVideoScript`) are **not**
returned here — only what a learner needs to pick and start.

---

## Get one — `GET /v1/speaking/scenarios/:id`

`:id` must be a v4 UUID. Returns a single card (same shape as a `data[]` item).
`404` if the scenario doesn't exist **or** isn't published.

---

## UX notes

- Use `introVideoUrl` when present to play the intro cutscene before the session;
  otherwise show a **scene card** built from `setting` + roles + `goal`.
- `seedPhrases` are good "useful phrases" hints to surface on the scene card.
- After the learner picks a scenario, collect which words they want to practise,
  then call `POST /v1/speaking/sessions` — see [speaking_practice_session.md](speaking_practice_session.md).
