# Decks — publish, browse community, and clone

Lets a user publish one of their decks to a public community catalog, lets anyone
browse that catalog, and lets a signed-in user save a copy of a seeded or public
deck into their own decks.

Covers:

- `POST /v1/me/decks` / `PATCH /v1/me/decks/:id` — the **`visibility`** field (publish/unpublish) — **JWT**
- `GET /v1/decks/public` — browse community decks — **no auth**
- `POST /v1/me/decks/:id/clone` — clone a deck into my own — **JWT**

See [api-endpoints.md](../backend/api-endpoints.md) for the terse contract and the rest of the `/v1/me/decks` CRUD surface.

---

## 1. Publishing a deck — `visibility`

`visibility` is now accepted on deck **create** and **update**.

| Field | Required? | Type | Rules |
|---|---|---|---|
| `visibility` | no | string enum | `private` (default) or `public`. `system` is **rejected** with `400` — it is reserved for the seeded catalog. |

- Omit it on create → the deck stays `private`.
- `PATCH` with `{ "visibility": "public" }` publishes it; `{ "visibility": "private" }` unpublishes it.
- **Privacy note:** publishing exposes every word in the deck — including the author's own
  user-created words — to anyone through `GET /v1/decks/public` and `GET /v1/decks/:id`.
  Surface this in the publish UI.

Example publish:

```http
PATCH /v1/me/decks/8f1d6c2e-3b4a-4c5d-9e0f-1a2b3c4d5e6f
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "visibility": "public" }
```

`200 OK` returns the deck detail; the deck now carries `"visibility": "public"`.

The deck summary/detail response now includes two extra fields so the client can tell
deck kinds apart:

| Field | Type | Meaning |
|---|---|---|
| `visibility` | `"system" \| "public" \| "private"` | `system` = seeded catalog deck; `public`/`private` = a user deck. |
| `ownerId` | `string \| null` | `null` for seeded decks; the author's user id for user decks. |

---

## 2. Browse the community catalog — `GET /v1/decks/public`

Public (no auth). Lists user decks that have been published as `public`, newest first.

| Query param | Required? | Type | Rules |
|---|---|---|---|
| `language` | no | string | ISO 639-1 (`^[a-z]{2}(-[A-Z]{2})?$`). |
| `cefrLevel` | no | string enum | `A1`–`C2`. |
| `page` | no | int | default `1`, min `1`. |
| `limit` | no | int | default `20`, max `100`. |

```http
GET /v1/decks/public?language=en&page=1&limit=20
```

`200 OK`:

```json
{
  "data": [
    {
      "id": "8f1d6c2e-3b4a-4c5d-9e0f-1a2b3c4d5e6f",
      "name": "IELTS Band 7 essentials",
      "description": "Words I drilled for the writing task",
      "language": "en",
      "cefrLevel": "B2",
      "vocabCount": 48,
      "visibility": "public",
      "ownerId": "11111111-1111-1111-1111-111111111111"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 3
}
```

Summary fields only — no vocab inlined. To preview a deck's words, call
`GET /v1/decks/:id` (works for `public` and seeded decks; a `private` deck returns `404`).

---

## 3. Clone a deck — `POST /v1/me/decks/:id/clone`

JWT. Copies a seeded (owner-less) or `public` deck into the caller's own decks as a
fresh **`private`** deck. Members are copied by reference (same vocabulary rows),
order preserved.

```http
POST /v1/me/decks/8f1d6c2e-3b4a-4c5d-9e0f-1a2b3c4d5e6f/clone
Authorization: Bearer <accessToken>
```

`201 Created` returns the **new** deck detail (new `id`, `ownerId` = me,
`visibility: "private"`, with the full ordered `vocabularies` list).

Path param: `:id` must be a UUID v4 — otherwise `400`.

### Errors

| Status | When |
|---|---|
| `400` | `:id` is not a valid UUID v4; or on publish, `visibility` is not `private`/`public`. |
| `401` | Missing/invalid JWT (clone and publish). |
| `404` | Source deck does not exist, **or** it is another user's `private` deck (existence is hidden deliberately — not `403`). |

### Client notes

- The clone is independent: editing or deleting the original does **not** affect the copy,
  and vice versa. The copy still references the original vocabulary rows, so if the original
  author deletes one of their words, that word also disappears from the clone (DB cascade).
- After cloning, treat the returned deck like any other owned deck (`/v1/me/decks/*`).
