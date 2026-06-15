# Decks — publish, browse community, and clone

Lets a user publish one of their decks to a public community catalog, lets anyone
browse that catalog, and lets a signed-in user save a copy of a seeded or public
deck into their own decks.

Covers:

- `POST /v1/me/decks` / `PATCH /v1/me/decks/:id` — the **`visibility`** field (publish/unpublish) — **JWT**
- `GET /v1/decks/public` — browse community decks — **no auth**
- `POST /v1/me/decks/:id/clone` — clone a deck into my own — **JWT**

See [api-endpoints.md](../backend/api-endpoints.md) for the terse contract and the rest of the `/v1/me/decks` CRUD surface.

> **Vocabulary unit = a deck.** Sharing happens at the **deck (list)** level, not per word.
> A user shares a *list* of words by publishing the deck that holds them; there is no
> endpoint to share a single vocabulary entry on its own.

---

## What "share to community" means here (mental model)

There are three deck *kinds*, distinguished by the `visibility` + `ownerId` pair the API
returns on every deck. The whole feature is just moving a user deck between `private` and
`public`, plus reading the public ones and copying them:

| Kind | `ownerId` | `visibility` | Who can see it | Where it shows up |
|---|---|---|---|---|
| **Seeded / system** | `null` | `system` | everyone | `GET /v1/decks`, `GET /v1/me/decks/suggested` |
| **My private deck** | me | `private` | only me | `GET /v1/me/decks` |
| **Community deck** | another user | `public` | everyone | `GET /v1/decks/public` |

A user **shares their list** by flipping one of their own decks `private → public`. Other
users **get shared lists** by browsing `GET /v1/decks/public` and then **cloning** one into
their own account (it lands back as a fresh `private` deck they own).

---

## End-to-end flow

### Journey A — author publishes a list to the community

```
[My Decks]  ──► open one of my decks ──► [Deck detail]
                                            │
                              toggle "Share to community"
                                            │
                                            ▼
              PATCH /v1/me/decks/:id   { "visibility": "public" }
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              │ 200 → deck.visibility = "public"                           │
              │       show a "Public" badge + "Anyone can find this list"  │
              │       confirmation; offer "Unpublish" (PATCH back private) │
              ├── 400 → visibility wasn't private/public (shouldn't happen  │
              │         from a toggle) → ignore / log                       │
              └── 401 → token expired → refresh / re-login                  │
```

> ⚠️ **Privacy gate before publishing.** Publishing exposes **every word in the deck**,
> including the author's own user-created (`source: "user"`) words, to anyone via
> `GET /v1/decks/public` and `GET /v1/decks/:id`. Show a confirm dialog the first time.

### Journey B — learner discovers and clones a community list

```
[Community / Explore tab]
        │
        │  GET /v1/decks/public?language=en&cefrLevel=B2&page=1   (no auth needed)
        ▼
[Grid of community decks]  ── each card: name, description, language, CEFR, vocabCount
        │
        │  tap a card
        ▼
GET /v1/decks/:id?translationLang=vi   ──► [Deck preview: ordered word list]
        │
        │  "Save to my decks"   (requires sign-in — gate here if anonymous)
        ▼
POST /v1/me/decks/:id/clone
        │
        ├── 201 → new PRIVATE deck owned by me (new id) → navigate to it under /v1/me/decks/*
        ├── 401 → not signed in → send to login, return here after
        └── 404 → deck vanished / went private since the list loaded → toast + refresh list
```

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
- **Studying works immediately.** Starting a `deck`-mode session (`POST /v1/me/learn/session`)
  auto-enrolls the cloned deck's words and `/v1/me/learn/answer` succeeds — even though those
  words are still owned (by reference) by the original author. Deck enrollment is authorized
  by deck membership, not vocabulary ownership.

---

## Suggested layout

Three surfaces fall out of the three operations. None of the shapes below are required by
the API — they're a starting point that matches the data you actually get back.

### A. Community / Explore page (browse) — `GET /v1/decks/public`

A filterable, paginated grid. Each card maps 1:1 to a `DeckSummary` (`name`, `description`,
`language`, `cefrLevel`, `vocabCount`). No words are inlined here — only fetch them on the
detail view.

```
┌ Community decks ─────────────────────────────────────────────┐
│ Filters:  Language [ en ▾ ]   Level [ Any ▾ ]        🔎       │
│                                                               │
│ ┌───────────────┐ ┌───────────────┐ ┌───────────────┐        │
│ │ IELTS Band 7  │ │ Travel basics │ │ Phrasal verbs │        │
│ │ essentials    │ │               │ │ A2            │        │
│ │ en · B2 · 48w │ │ en · A2 · 30w │ │ en · A2 · 25w │        │
│ │ "Words I…"    │ │ "Common…"     │ │ "Everyday…"   │        │
│ │ [ Preview ]   │ │ [ Preview ]   │ │ [ Preview ]   │        │
│ └───────────────┘ └───────────────┘ └───────────────┘        │
│                                                               │
│            ‹ Prev   page 1 / 4   Next ›                       │
└───────────────────────────────────────────────────────────────┘
```

- Drive the pager from `{ page, limit, total }`. `total / limit` → page count.
- Filters map straight to `?language=` and `?cefrLevel=`. Debounce and reset to `page=1`.
- This endpoint needs **no auth** — render it for logged-out visitors too, but gate the
  **Save** action behind sign-in.

### B. Deck preview (community detail) — `GET /v1/decks/:id`

Read-only. Shows the ordered `vocabularies[]`. Primary action is **Save to my decks**
(clone). Pass `?translationLang=` to show the viewer's language on each word.

```
┌ IELTS Band 7 essentials        en · B2 · 48 words   [ Save to my decks ] ┐
│ "Words I drilled for the writing task"                                    │
│ by @author                                                                │
│ ─────────────────────────────────────────────────────────────────────── │
│  1. resilient   /rɪˈzɪliənt/   adj   — kiên cường                         │
│  2. mitigate    /ˈmɪtɪɡeɪt/    verb  — giảm nhẹ                            │
│  3. …                                                                     │
└───────────────────────────────────────────────────────────────────────── ┘
```

- **Save to my decks** → `POST /v1/me/decks/:id/clone` → on `201` route to the new deck
  under `/v1/me/decks/:newId`. If the user is anonymous, send them to login first and
  return here.
- A `404` here means the deck is private or gone — show "This list is no longer available"
  and bounce back to the grid.

### C. Owner's deck detail — the publish toggle (`PATCH /v1/me/decks/:id`)

On a deck the user **owns**, add a share control driven by `visibility`.

```
┌ My A1 starter                              [ ●  Share to community ] ┐
│ 32 words · en · A1                          status: 🔒 Private        │
└──────────────────────────────────────────────────────────────────── ┘

  toggled ON  → confirm dialog → PATCH { visibility: "public" }  → 🌐 Public  + copy link
  toggled OFF → PATCH { visibility: "private" }                  → 🔒 Private
```

- Render the toggle state from `deck.visibility` (`public` = on). Only show it when
  `ownerId === me`; **never** show it on seeded (`system`) decks.
- First time turning it on, show the privacy confirm dialog (see the warning in §1).
- When `public`, expose a shareable link to the deck's public detail page and an
  **Unpublish** path (`PATCH` back to `private`).

### Cross-cutting

- **Tell deck kinds apart with `visibility` + `ownerId`** — that's the only signal. Owned
  + `public`/`private` → show owner controls; `system` → catalog, no owner controls;
  someone else's `public` → community card with Save.
- **Clone always produces a private copy**, even from a public source. After the call,
  the deck lives entirely under `/v1/me/decks/*`; the user edits/learns it like any other.
- **Empty / loading states**: the public grid can legitimately return `total: 0` (no one
  has published for that filter) — show an empty-state, not an error.
