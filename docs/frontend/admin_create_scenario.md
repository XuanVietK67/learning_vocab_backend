# Admin — Author speaking-room scenarios (frontend guide)

How the **admin "speaking-room scenarios" screen** talks to the backend. A *scenario* is a reusable spoken-conversation spec (setting, roles, goal, opening line) authored once and practiced by many learners later (Phase 2). This is **Phase 1 — authoring only**; there is no live conversation yet.

- **Base path:** `/v1/admin/scenarios`
- **Auth:** `Authorization: Bearer <accessToken>` — the signed-in user must have role `admin` (else `403`)
- **Content type:** `application/json`
- Canonical contract: [api-endpoints.md](../backend/api-endpoints.md) · general conventions: [frontend_handoff.md](frontend_handoff.md) · design rationale: [speaking_room_phase1_admin_authoring.md](../plans/speaking_room_phase1_admin_authoring.md)

---

## Lifecycle

```
POST /v1/admin/scenarios                → status: "draft"
        │  (edit freely while draft — no version bump)
        ▼
POST /v1/admin/scenarios/:id/publish    → status: "published"
        │  (editing now bumps `version` so in-flight Phase 2 sessions are stable)
        ▼
DELETE /v1/admin/scenarios/:id          → status: "retired"  (soft-delete, 204)
        │
        └─ POST .../publish again → back to "published"
```

`intro-video` is optional and can be attached at any point — Phase 1 does **not** render it; you supply a finished MP4 URL produced out-of-band.

---

## Endpoints

### `POST /v1/admin/scenarios` — create (201)

Creates a scenario in `draft`. The server sets `status`, `version: 1`, and `createdBy` (from your token).

```jsonc
{
  "title": "Ordering at a café",          // required
  "topic": "food",                         // required — lowercase slug [a-z0-9-]
  "cefrLevel": "B1",                       // optional — A1..C2; omit = "any"
  "setting": "A busy café at lunchtime.",  // required
  "aiRole": "barista",                     // required
  "userRole": "customer",                  // required
  "goal": "Order a drink and a snack, and ask for the price.", // required
  "openingLine": "Hi there! What can I get for you today?",    // required
  "seedPhrases": ["I'd like...", "How much is...", "for here or to go"], // optional
  "estTurns": 8,                           // optional — 1..100
  "introVideoScript": null                 // optional — script text for a later render
}
```

### `GET /v1/admin/scenarios` — list (200)

Query params (all optional): `topic` (slug), `cefrLevel` (`A1`..`C2`), `status` (`draft`/`published`/`retired`), `page` (default 1), `limit` (default 20, max 100). Newest first.

```jsonc
{ "data": [ /* ScenarioResponse[] */ ], "page": 1, "limit": 20, "total": 1 }
```

### `GET /v1/admin/scenarios/:id` — read one (200 / 404)

Returns the full scenario (see response shape). `404` if the id is unknown.

### `PATCH /v1/admin/scenarios/:id` — edit (200)

Any subset of the create fields. Editing a **published** scenario increments `version`; editing a draft does not.

### `POST /v1/admin/scenarios/:id/intro-video` — attach video (200)

```jsonc
{
  "introVideoUrl": "https://cdn.example.com/scenarios/cafe-b1/intro.mp4", // required, http(s)
  "introVideoScript": "..."   // optional — update the script too
}
```

### `POST /v1/admin/scenarios/:id/publish` — publish (200)

Moves a `draft` or `retired` scenario to `published`. `400` if it is already published.

### `DELETE /v1/admin/scenarios/:id` — retire (204)

Soft-delete: sets `status: "retired"`. Idempotent (retiring an already-retired scenario still returns 204). Nothing is hard-deleted.

---

## Field rules (create / edit)

| Field | Required | Type | Rules |
|---|---|---|---|
| `title` | ✅ | string | 1–160 chars |
| `topic` | ✅ | string | 1–64 chars, lowercase slug `^[a-z0-9-]+$` |
| `cefrLevel` | — | enum | `A1`,`A2`,`B1`,`B2`,`C1`,`C2`; omit/`null` = any level |
| `setting` | ✅ | string | 1–2000 chars |
| `aiRole` | ✅ | string | 1–120 chars |
| `userRole` | ✅ | string | 1–120 chars |
| `goal` | ✅ | string | 1–1000 chars |
| `openingLine` | ✅ | string | 1–1000 chars |
| `seedPhrases` | — | string[] | ≤ 20 items, each 1–200 chars |
| `estTurns` | — | integer | 1–100 |
| `introVideoScript` | — | string | 1–5000 chars |

`introVideoUrl`, `status`, `version`, `createdBy` are **server-controlled** — don't send them in create/edit. Validation is strict: unknown body fields are rejected with `400`.

---

## Response shape (`ScenarioResponse`)

```jsonc
{
  "id": "3f1c…",
  "title": "Ordering at a café",
  "topic": "food",
  "cefrLevel": "B1",                       // or null
  "setting": "A busy café at lunchtime.",
  "aiRole": "barista",
  "userRole": "customer",
  "goal": "Order a drink and a snack, and ask for the price.",
  "openingLine": "Hi there! What can I get for you today?",
  "seedPhrases": ["I'd like...", "How much is...", "for here or to go"],
  "estTurns": 8,
  "introVideoScript": null,
  "introVideoUrl": null,
  "status": "draft",                       // draft | published | retired
  "version": 1,
  "createdBy": "admin-uuid",               // or null if the author was deleted
  "createdAt": "2026-06-24T10:00:00.000Z",
  "updatedAt": "2026-06-24T10:00:00.000Z"
}
```

---

## Errors

| Status | When |
|---|---|
| `400` | validation failure, unknown body field, or `publish` on an already-published scenario |
| `401` | missing/expired token → send to login / refresh |
| `403` | logged in but not an admin → hide the screen |
| `404` | scenario id unknown |
