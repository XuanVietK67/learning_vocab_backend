# Frontend Handoff

Index for frontend engineers integrating with this backend. This file holds the **shared conventions** (base URL, versioning, auth, pagination, errors) and a **table of contents** linking to one doc per feature/endpoint. The concrete request/response shapes for each endpoint live in their own per-feature docs under [docs/](.) — see the index below. For the canonical, terse contract see [api-endpoints.md](../backend/api-endpoints.md).

> Per-feature docs are the source for request/response shapes. When you add or change an endpoint, create/update its per-feature doc and link it from the index below — see [../CLAUDE.md](../../CLAUDE.md). The detailed endpoint sections still inline below are legacy and are being migrated into per-feature docs incrementally.

## Base URL and conventions

- **Base URL (local dev):** `http://localhost:3000` (port via `PORT` env; see [.env.example](../../.env.example)).
- **API version prefix:** `/v1`. All controllers are mounted under `/v1/...`. The only unversioned route is `GET /` (liveness).
- **Content type:** all requests and responses are `application/json`. Send `Content-Type: application/json`.
- **Validation:** global `ValidationPipe` with `whitelist + forbidNonWhitelisted + transform` — unknown body fields → `400`.
- **Auth header (when required):** `Authorization: Bearer <accessToken>`. Access token lifetime defaults to `15m`; refresh token lifetime defaults to `30d`. Refresh tokens are rotated on every `/auth/refresh` — store the new one immediately.
- **IDs:** UUID v4 strings.
- **Timestamps:** ISO 8601 strings in UTC (e.g. `2026-05-26T08:30:00.000Z`).
- **Language codes:** ISO 639-1, optionally with region (regex `^[a-z]{2}(-[A-Z]{2})?$`) — e.g. `en`, `vi`, `pt-BR`.
- **CEFR levels:** one of `A1`, `A2`, `B1`, `B2`, `C1`, `C2`.

### Pagination

List endpoints accept `page` (default `1`) and `limit` (default `20`, max `100`) and return:

```json
{ "data": [ /* items */ ], "page": 1, "limit": 20, "total": 137 }
```

### Errors

Standard Nest error shape:

```json
{ "statusCode": 400, "message": ["email must be an email"], "error": "Bad Request" }
```

Common codes used across the API: `400` validation, `401` missing/invalid JWT, `403` ownership/role mismatch, `404` not found, `409` conflict (duplicate natural key), `429` rate-limited (login).

---

## Per-feature guides (index)

One doc per feature/endpoint. Add a row here whenever you create a new per-feature doc.

| Feature | Method + path | Auth | Doc |
|---|---|---|---|
| Auth — login session, access & refresh tokens | `POST /v1/auth/{register,login,refresh,logout}`, `GET /v1/auth/me` | mixed | [auth_session_tokens.md](auth_session_tokens.md) |
| User — read & update profile (onboarding + leaderboard opt-out) | `GET /v1/users/:id`, `PATCH /v1/users/:id` | user (self) | [users_profile.md](users_profile.md) |
| Admin — create vocabulary | `POST /v1/admin/vocabularies` | admin | [admin_create_vocabulary.md](admin_create_vocabulary.md) |
| Admin — quick-create vocabulary (lemma only) | `POST /v1/admin/vocabularies/quick`, `GET /v1/admin/vocabularies/quick/:jobId`, `POST /v1/admin/vocabularies/:id/approve` | admin | [admin_quick_create_vocabulary.md](admin_quick_create_vocabulary.md) |
| Admin — bulk quick-create (list / Excel / PDF) | `POST /v1/admin/vocabularies/quick/extract`, `POST /v1/admin/vocabularies/quick/bulk`, `GET /v1/admin/vocabularies/quick/batch/:batchId` | admin | [admin_bulk_quick_create_vocabulary.md](admin_bulk_quick_create_vocabulary.md) |
| Admin — list vocabularies | `GET /v1/admin/vocabularies` | admin | [admin_list_vocabularies.md](admin_list_vocabularies.md) |
| Admin — get one vocabulary (incl. drafts) | `GET /v1/admin/vocabularies/:id` | admin | [admin_get_vocabulary.md](admin_get_vocabulary.md) |
| Decks — publish, browse community & clone | `GET /v1/decks/public`, `POST /v1/me/decks/:id/clone`, `visibility` on `POST/PATCH /v1/me/decks` | mixed | [decks_share_and_clone.md](decks_share_and_clone.md) |
| My Vocabularies — quick-create from a lemma | `POST /v1/me/vocabularies/quick-create`, `GET /v1/me/vocabularies/jobs/:jobId` | user | [me_vocabulary_quick_create.md](me_vocabulary_quick_create.md) |
| Decks — bulk-import words from a lemma list | `POST /v1/me/decks/:id/bulk-import`, `GET /v1/me/vocabularies/batches/:batchId` | user | [decks_bulk_import.md](decks_bulk_import.md) |
| Design — user vocabulary lists (screens & flows for the 3 phases) | (layout guide, cross-feature) | user | [user_vocab_lists_design.md](user_vocab_lists_design.md) |
| User — learn vocabulary flow | `POST /v1/me/learn/session`, `POST /v1/me/learn/answer`, `/v1/me/progress/*`, `GET /v1/me/stats` | user | [learn_vocabulary_flow.md](learn_vocabulary_flow.md) |
| User — learn session UI flow (screen-by-screen journey) | `GET /v1/me/stats`, `GET /v1/topics`, deck list APIs, `POST /v1/me/learn/{session,answer}` | user | [learn_session_ui_flow.md](learn_session_ui_flow.md) |
| User — practice sentence scoring | `POST /v1/me/practice/attempts`, `GET /v1/me/practice/attempts/:id` | user | [practice_submit_sentence.md](practice_submit_sentence.md) |
| User — pronunciation scoring | `POST /v1/pronunciation/score`, `GET /v1/pronunciation/attempts` | user | [pronunciation_score.md](pronunciation_score.md) |
| User — learn `pronunciation` question (acoustic scoring) | `POST /v1/pronunciation/score` → `POST /v1/me/learn/answer` | user | [learn_pronunciation_question.md](learn_pronunciation_question.md) |
| User — activity heatmap (contribution calendar) | `GET /v1/me/activity` | user | [me_activity_heatmap.md](me_activity_heatmap.md) |
| Community — leaderboard (top learners; `new_words` board is Phase 2) | `GET /v1/leaderboard` | user | [community_leaderboard.md](community_leaderboard.md) |

---

## Health

### `GET /`
Liveness check. No auth.

**Response 200**

```text
Hello World!
```

(plain text)

---

## Auth — `/v1/auth`

All auth responses (except `/me` and `/logout`) share this shape:

```json
{
  "accessToken": "eyJhbGciOi...",
  "refreshToken": "f0e1d2c3-b4a5-...",
  "user": { /* UserResponse, see GET /v1/auth/me */ }
}
```

### `POST /v1/auth/register`
Create an email + password account. No auth.

**Request body**

```json
{
  "email": "alice@example.com",
  "password": "correct horse battery staple",
  "username": "alice_99"
}
```

- `password`: 8–72 chars.
- `username`: 3–30 chars, `[a-zA-Z0-9_]+`.

**Response 201**: `AuthResponse` (see shape above).

### `POST /v1/auth/login`
Email + password login. No auth. Rate-limited per IP (default 5 attempts / 15 min).

**Request body**

```json
{ "email": "alice@example.com", "password": "correct horse battery staple" }
```

**Response 200**: `AuthResponse`. **429** when rate-limited.

### `POST /v1/auth/refresh`
Exchange a refresh token for a fresh pair. No auth header — refresh token goes in the body.

**Request body**

```json
{ "refreshToken": "f0e1d2c3-b4a5-..." }
```

**Response 200**: `AuthResponse`. The old refresh token is revoked — replace it client-side with the new one.

### `POST /v1/auth/logout`
Revoke a refresh token. No auth header.

**Request body**

```json
{ "refreshToken": "f0e1d2c3-b4a5-..." }
```

**Response 204** (empty body).

### `POST /v1/auth/google`
Sign in / sign up with a Google ID token (from Google Identity Services on the client).

**Request body**

```json
{ "idToken": "eyJhbGciOi..." }
```

**Response 200**: `AuthResponse`.

### `POST /v1/auth/apple`
Sign in / sign up with an Apple ID token (from Sign in with Apple). `fullName` is forwarded only on first sign-in (Apple omits it on subsequent logins).

**Request body**

```json
{ "idToken": "eyJhbGciOi...", "fullName": "Alice Example" }
```

**Response 200**: `AuthResponse`.

### `POST /v1/auth/github`
Sign in / sign up with a GitHub OAuth authorization `code` (from the OAuth redirect).

**Request body**

```json
{ "code": "abc123def456..." }
```

**Response 200**: `AuthResponse`.

### `GET /v1/auth/me`
Return the currently authenticated user. **JWT required.**

**Response 200** — `UserResponse`:

```json
{
  "id": "9f1a...",
  "email": "alice@example.com",
  "username": "alice_99",
  "avatarUrl": null,
  "role": "user",
  "isEmailVerified": false,
  "isActive": true,
  "isOnboarded": false,
  "nativeLanguage": null,
  "targetLanguage": null,
  "proficiencyLevel": null,
  "dailyGoalMinutes": null,
  "weeklyVocabGoal": null,
  "createdAt": "2026-05-26T08:30:00.000Z",
  "updatedAt": "2026-05-26T08:30:00.000Z"
}
```

`role` is `"user"` or `"admin"`. Use it to gate admin UI surfaces.

### `POST /v1/auth/email/send-verification`
Email a 6‑digit verification code to the authenticated user. **JWT required.** No body.

Throttling: max 3 requests per minute per caller, and a 60‑second cooldown between successive codes for the same user. Sending a new code invalidates any previous unconsumed code for the user.

**Response 202**

```json
{ "expiresAt": "2026-05-26T08:40:00.000Z" }
```

**Errors**

- `400` — `email already verified`
- `429` — `please wait before requesting another code` (within the 60s cooldown). The response body includes `retryAfter` (seconds).
- `503` — `failed to send verification email` (SMTP transport failed).

### `POST /v1/auth/email/verify`
Verify the 6‑digit code the user received by email. **JWT required.** On success the user's `isEmailVerified` flips to `true`.

**Request body**

```json
{ "code": "482917" }
```

- `code`: exactly 6 digits (`^\d{6}$`).

**Response 200** — full `UserResponse` (same shape as `GET /v1/auth/me`), with `isEmailVerified: true`.

**Errors**

- `400` — `email already verified` | `no active verification code, request a new one` | `invalid code` (response body includes `attemptsRemaining`) | `too many attempts, request a new code` (after 5 wrong attempts the code is invalidated; user must request a new one).

---

## Users — `/v1/users`

### `GET /v1/users/:id` · `PATCH /v1/users/:id`
Read and update the caller's own profile (onboarding fields + the `leaderboardOptOut` privacy toggle). JWT required, self only. Full request/response shape: **[users_profile.md](users_profile.md)**.

---

## Admin Users — `/v1/admin/users`

Admin-only surface for user accounts. **JWT required** and the caller's `role` must be `"admin"` (else `403`).

### `DELETE /v1/admin/users/:id`
Hard-delete a non-admin user. Cascades remove the user's refresh tokens, OAuth identities, verification codes, progress rows, and personally-owned decks. User-created vocabularies (`source='user'`) are kept; their `created_by_user_id` is set to `NULL`.

**Response 204** (empty body).

**Errors**

- `403` — caller is not an admin, or `cannot delete an admin account` (target is an admin).
- `404` — user not found.

---

## Vocabularies — `/v1/vocabularies` (public catalog)

Read-only access to the curated system catalog (`source = 'system'`). User-created words live under `/v1/me/vocabularies`.

### `GET /v1/vocabularies`
List system vocabularies, ordered by frequency rank then lemma. No auth.

**Query params (all optional)**

| Name | Type | Notes |
| --- | --- | --- |
| `language` | string | ISO 639-1. |
| `cefrLevel` | enum | `A1`…`C2`. |
| `topic` | string | Topic slug. |
| `q` | string | Lemma prefix search. |
| `translationLang` | string | Restrict nested `translations[]` to this language. |
| `page` | int | Default `1`. |
| `limit` | int | Default `20`, max `100`. |

**Example**

```http
GET /v1/vocabularies?language=en&cefrLevel=A2&translationLang=vi&page=1&limit=20
```

**Response 200**

```json
{
  "data": [
    {
      "id": "c2a1...",
      "language": "en",
      "lemma": "study",
      "partOfSpeech": "verb",
      "ipa": "/ˈstʌd.i/",
      "cefrLevel": "A2",
      "frequencyRank": 412,
      "audioUrl": "https://.../study-v.mp3",
      "source": "system",
      "enrichmentStatus": null,
      "senses": [
        {
          "id": "s-001",
          "senseOrder": 1,
          "gloss": "to learn for school/exam",
          "definition": "spend time learning a subject, especially for a test",
          "imageUrl": "https://.../study-learn.jpg",
          "synonyms": ["learn", "revise"],
          "antonyms": [],
          "translations": [
            { "id": "t-001", "language": "vi", "translation": "học, học tập", "note": null, "source": "manual" }
          ],
          "examples": [
            { "id": "e-001", "sentence": "She studies biology at university.", "translation": "Cô ấy học sinh học ở trường đại học.", "source": "oxford" }
          ]
        },
        {
          "id": "s-002",
          "senseOrder": 2,
          "gloss": "to examine carefully",
          "definition": null,
          "imageUrl": null,
          "synonyms": [],
          "antonyms": [],
          "translations": [
            { "id": "t-002", "language": "vi", "translation": "nghiên cứu, xem xét kỹ", "note": null, "source": "manual" }
          ],
          "examples": []
        }
      ],
      "topics": [
        { "id": "tp-001", "slug": "education", "name": "Education", "description": null, "iconUrl": null }
      ]
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 542
}
```

A `Vocabulary` always carries one or more **senses** (distinct meanings). `translations[]` and `examples[]` live **inside** a sense — the top-level vocabulary no longer exposes them. Different senses can carry different `imageUrl` values; `audioUrl` lives on the vocabulary (pronunciation is shared across senses). Senses are returned ordered by `senseOrder ASC`. The top-level `topics[]` (sorted by slug) lists every topic linked to the vocabulary via `vocabulary_topics`; it is `[]` when the word has no topics. Each entry matches the `Topic` shape from `/v1/topics`.

Each sense also carries `synonyms[]` and `antonyms[]` — plain string arrays (empty `[]` when none). Each translation carries a `source` string marking provenance (`"manual"`, `"mt:google"`, `"cambridge"`, …) or `null`. At the vocabulary level, `enrichmentStatus` is `null` for words created with full data; for words created via background dictionary enrichment it is `"pending"`, `"enriched"`, or `"failed"`. A `"pending"` or `"failed"` word may have senses without the ≥2 examples the study flow needs, so treat it as not-yet-study-ready.

### `GET /v1/vocabularies/:id`
Fetch one vocabulary with all of its senses, translations, and examples. No auth.

**Query**: `translationLang` (optional — when set, filters translations inside every sense to that language).

**Response 200**: a single `Vocabulary` object (same shape as `data[]` above).

---

## My Vocabularies — `/v1/me/vocabularies`

The caller's own (`source = 'user'`, `visibility = 'private'`) words. All endpoints require JWT; cross-user access → `403`.

### `POST /v1/me/vocabularies`
Create a personal word with one or more senses (meanings). Each sense carries its own translations, examples, and optional image. `topics[]` and `audioUrl` live at the vocabulary level. Topic slugs must already exist.

**Request body**

```json
{
  "language": "en",
  "lemma": "serendipity",
  "partOfSpeech": "noun",
  "ipa": "/ˌser.ənˈdɪp.ə.ti/",
  "cefrLevel": "C1",
  "audioUrl": null,
  "topics": ["abstract-ideas"],
  "senses": [
    {
      "gloss": "fortunate accident",
      "definition": "the occurrence of events by chance in a happy or beneficial way",
      "imageUrl": null,
      "synonyms": ["chance", "fluke"],
      "antonyms": ["misfortune"],
      "translations": [
        { "language": "vi", "translation": "sự tình cờ may mắn", "source": "manual" }
      ],
      "examples": [
        { "sentence": "Meeting her was pure serendipity." },
        { "sentence": "Finding that book was a moment of serendipity.", "translation": "Tìm thấy cuốn sách đó là một khoảnh khắc tình cờ may mắn." }
      ]
    }
  ]
}
```

**Top-level fields**

- `language`: required, ISO 639 code matching `^[a-z]{2}(-[A-Z]{2})?$` (e.g. `en`, `vi`, `pt-BR`), 2–8 chars.
- `lemma`: required, 1–128 chars.
- `partOfSpeech`: required, one of `noun`, `verb`, `adjective`, `adverb`, `pronoun`, `preposition`, `conjunction`, `interjection`, `phrase`, `other`.
- `ipa?`: optional, 1–128 chars. `cefrLevel?`: optional, one of `A1`–`C2`. `frequencyRank?`: optional integer ≥ 0.
- `audioUrl?`: optional, 1–512 chars — omit (or send `null`) to trigger background generation (see audio note below).
- `topics?`: optional, ≤32 slugs, each matching `[a-z0-9-]+`. Slugs must already exist.
- `senses`: required, 1–16 items. Order in the request becomes `senseOrder` (1-indexed).

**Per sense** — `{ gloss?, definition?, imageUrl?, synonyms?[], antonyms?[], translations?[], examples[] }`

- `gloss?` ≤128, `definition?` ≤2000, `imageUrl?` ≤512 chars.
- `synonyms?` / `antonyms?`: optional string arrays, ≤32 items, each 1–64 chars. Omitted → stored as `[]`.
- `examples`: **required, 2–16 items** per sense (the learn feature holds extra examples back as test sentences, so a single example is rejected with `400`). Each example is `{ sentence (1–1000), translation? (1–1000), source? (≤32) }`.
- `translations?`: optional, ≤16 items. Each is `{ language (ISO 639), translation (1–255), note? (1–2000), source? }`.
- translation `source?`: optional provenance string, ≤32 chars (e.g. `"manual"`). Omitted → defaults to `"manual"`.

**Response 201**: `Vocabulary` object. **409** if you already own `(language, lemma, partOfSpeech)`.

> **Audio is auto-generated.** If you omit `audioUrl` (or send `null`), the server queues background pronunciation-audio generation and the create response comes back with `audioUrl: null`. Re-fetch `GET /v1/me/vocabularies/:id` a few seconds later to pick up the populated URL. If you supply your own `audioUrl`, it is kept and no generation runs.

### `GET /v1/me/vocabularies`
List your own vocabularies, newest first.

**Query**: `language`, `q`, `translationLang`, `page`, `limit` (same defaults as the public list).

**Response 200**: paginated `Vocabulary` list.

### `GET /v1/me/vocabularies/:id`
**Query**: `translationLang`. **Response 200**: `Vocabulary` with its `senses[]` (each containing `translations[]` and `examples[]`). **403** if not the owner.

### `PATCH /v1/me/vocabularies/:id`
Partial update of top-level fields only (`language`, `lemma`, `partOfSpeech`, `ipa`, `cefrLevel`, `frequencyRank`, `audioUrl`). Senses, translations, examples, and topic links are not patched here — re-create the vocabulary or use dedicated mutation paths once they exist.

**Response 200**: updated `Vocabulary`.

### `DELETE /v1/me/vocabularies/:id`
**Response 204**. Cascades to translations, examples, topic links, deck memberships, and progress rows.

---

## Admin Vocabularies — `/v1/admin/vocabularies`

Requires JWT **and** `role = 'admin'` (`403` otherwise).

### `GET /v1/admin/vocabularies`
Lists the entire `vocabularies` table (system + user-created) with admin-only fields inlined, including a top-level `imageUrl` thumbnail per row. Full request/response shape: **[admin_list_vocabularies.md](admin_list_vocabularies.md)**.

### `GET /v1/admin/vocabularies/:id`
Read one system vocabulary by id, **including unapproved quick-create drafts** (the public `GET /v1/vocabularies/:id` 404s on those). The read for the pre-approval edit screen. Full request/response shape: **[admin_get_vocabulary.md](admin_get_vocabulary.md)**.

### `POST /v1/admin/vocabularies`
Body identical to `POST /v1/me/vocabularies`, but `source` is `'system'` on the resulting row. **409** on duplicate natural key — use bulk-import for upsert semantics.

> **Audio is auto-generated** the same way as `POST /v1/me/vocabularies`: omit `audioUrl` for background generation (response returns `audioUrl: null`; re-fetch shortly after), or supply your own to skip it.

### `POST /v1/admin/vocabularies/bulk-import`
Idempotent upsert of up to 500 items in one transaction. Each item carries the full sense tree (same shape as `POST /v1/me/vocabularies`).

**Request body**

```json
{
  "items": [
    {
      "language": "en",
      "lemma": "apple",
      "partOfSpeech": "noun",
      "senses": [
        {
          "gloss": "fruit",
          "translations": [ { "language": "vi", "translation": "quả táo" } ],
          "examples": [
            { "sentence": "I ate an apple." },
            { "sentence": "She bought a bag of apples." }
          ]
        }
      ]
    }
  ]
}
```

**Response 201**

```json
{
  "upserted": 500,
  "inserted": 320,
  "updated": 180,
  "sensesAdded": 540,
  "translationsAdded": 412,
  "examplesAdded": 87,
  "topicLinksAdded": 245
}
```

Upsert semantics for senses: existing senses are matched by `senseOrder` (1-indexed by position in the request). Existing positions are patched in place; new positions are inserted. Translations are matched by `(language, translation)` within a sense and inserted if missing. Examples are append-only and only inserted when the target sense had none beforehand.

### `PATCH /v1/admin/vocabularies/:id`
Same partial-update semantics as the user endpoint. Returns the updated `Vocabulary`.

### `DELETE /v1/admin/vocabularies/:id`
**Response 204**.

### `POST /v1/admin/vocabularies/:id/senses`
Append a new sense. `senseOrder` is auto-assigned to `max+1`. Translations and examples are optional at create time — both can be added later via the dedicated subresource routes.

**Request body**

```json
{
  "gloss": "company",
  "definition": "An American technology company.",
  "imageUrl": null,
  "translations": [
    { "language": "vi", "translation": "công ty Apple" }
  ],
  "examples": [
    { "sentence": "Apple released a new product." }
  ]
}
```

**Response 201**: the created `Sense` with its `translations[]` and `examples[]` inlined.

### `PATCH /v1/admin/vocabularies/:id/senses/:senseId`
Patch any subset of `gloss`, `definition`, `imageUrl`. Cannot reorder via this endpoint — use `PUT /senses/reorder`.

**Response 200**: the updated `Sense` (with translations + examples).

### `DELETE /v1/admin/vocabularies/:id/senses/:senseId`
**Response 204**. Cascades to the sense's translations and examples. Remaining sibling senses are compacted so `senseOrder` stays contiguous `1..N`.

### `PUT /v1/admin/vocabularies/:id/senses/reorder`
Reassign `senseOrder` by array position (`senseIds[0]` becomes order 1, `senseIds[1]` becomes 2, …).

**Request body**

```json
{ "senseIds": ["…sense-uuid-A…", "…sense-uuid-B…", "…sense-uuid-C…"] }
```

`senseIds` must be a permutation of the vocab's current sense ids — same length, same members, no duplicates. Returns `400` otherwise.

**Response 200**: the full sense list in the new order, each with translations + examples.

### `POST /v1/admin/vocabularies/:id/senses/:senseId/translations`
**Request body**

```json
{ "language": "vi", "translation": "quả táo", "note": null }
```

- `language`: ISO 639-1 (e.g. `en`, `vi`, `pt-BR`).
- 409 if `(senseId, language, translation)` already exists.

**Response 201**: `Translation`.

### `PATCH /v1/admin/vocabularies/:id/senses/:senseId/translations/:translationId`
Body: any subset of `language`, `translation`, `note`. Re-checks the unique `(senseId, language, translation)` constraint — 409 on conflict.

**Response 200**: updated `Translation`.

### `DELETE /v1/admin/vocabularies/:id/senses/:senseId/translations/:translationId`
**Response 204**.

### `POST /v1/admin/vocabularies/:id/senses/:senseId/examples`
**Request body**

```json
{ "sentence": "I ate an apple.", "translation": "Tôi đã ăn một quả táo.", "source": "manual" }
```

- `source` defaults to `"manual"` if omitted.

**Response 201**: `Example`.

### `PATCH /v1/admin/vocabularies/:id/senses/:senseId/examples/:exampleId`
Body: any subset of `sentence`, `translation`, `source`.

**Response 200**: updated `Example`.

### `DELETE /v1/admin/vocabularies/:id/senses/:senseId/examples/:exampleId`
**Response 204**.

### `PUT /v1/admin/vocabularies/:id/topics`
Replace the entire topic-link set for the vocabulary. Set-replace semantics — slugs not present in the body are unlinked, slugs not currently linked are linked, the rest is left alone.

**Request body**

```json
{ "slugs": ["food", "fruit"] }
```

- `slugs` size 0–32; empty `[]` clears all topic links.
- All slugs must exist in the topic catalog — `400` with the list of unknown slugs otherwise.

**Response 200**: the resulting topic set, sorted by slug.

```json
[
  { "id": "…", "slug": "food", "name": "Food & Drink", "description": null, "iconUrl": null },
  { "id": "…", "slug": "fruit", "name": "Fruit", "description": null, "iconUrl": null }
]
```

---

## Topics — `/v1/topics` (public)

### `GET /v1/topics`
Flat array (no pagination — the set is small). No auth.

**Response 200**

```json
[
  { "id": "…", "slug": "food", "name": "Food & Drink", "description": null, "iconUrl": null },
  { "id": "…", "slug": "travel", "name": "Travel", "description": null, "iconUrl": null }
]
```

### `GET /v1/topics/:slug`
**Response 200**: one `Topic`. **404** if unknown slug.

---

## Admin Topics — `/v1/admin/topics`

Requires JWT + `role = 'admin'`.

### `POST /v1/admin/topics`

**Request body**

```json
{ "slug": "food", "name": "Food & Drink", "description": "Words about meals, dishes, ingredients", "iconUrl": null }
```

- `slug`: 2–64 chars, `[a-z0-9-]+`.

**Response 201**: `Topic`. **409** if slug exists.

### `PATCH /v1/admin/topics/:slug`
Body: any subset of `name`, `description`, `iconUrl`. Slug is the identifier and not editable (DELETE + POST to rename). **Response 200**: updated `Topic`.

### `DELETE /v1/admin/topics/:slug`
**Response 204**. Cascades the `vocabulary_topics` link rows (vocabularies stay, just lose the tag).

---

## Decks — `/v1/decks` (public catalog)

System decks (`owner_id IS NULL`).

### `GET /v1/decks`
**Query**: `language`, `cefrLevel`, `page`, `limit`. No auth.

**Response 200** — summary fields only, no vocabularies inlined:

```json
{
  "data": [
    {
      "id": "…",
      "name": "Travel Essentials A2",
      "description": "Common words for travel",
      "language": "en",
      "cefrLevel": "A2",
      "vocabCount": 50
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 12
}
```

### `GET /v1/decks/:id`
**Query**: `translationLang`. No auth.

**Response 200** — summary fields plus ordered `vocabularies[]` (each with its `translations[]`):

```json
{
  "id": "…",
  "name": "Travel Essentials A2",
  "description": "Common words for travel",
  "language": "en",
  "cefrLevel": "A2",
  "vocabCount": 50,
  "vocabularies": [ /* Vocabulary objects in deck order */ ]
}
```

### `GET /v1/me/decks/suggested`
**JWT required.** Returns system decks matching the caller's `targetLanguage` + `proficiencyLevel` (from onboarding). Empty array if either is unset.

**Response 200**: array of `DeckSummary`.

---

## My Decks — `/v1/me/decks`

Personal decks owned by the caller (`owner_id = me`, `visibility = 'private'`). All endpoints require JWT.

### `POST /v1/me/decks`

**Request body**

```json
{
  "name": "My A1 starter",
  "description": "Words I’m focusing on this week",
  "language": "en",
  "cefrLevel": "A1",
  "vocabularyIds": ["uuid-1", "uuid-2"]
}
```

- `vocabularyIds`: optional. Inaccessible IDs (other users' private words, non-existent IDs) are silently skipped on create — use the membership endpoint if you need a report.

**Response 201**: full `DeckDetail` (same shape as `GET /v1/decks/:id`).

### `GET /v1/me/decks`
**Query**: `language`, `cefrLevel`, `page`, `limit`. **Response 200**: paginated `DeckSummary` list.

### `GET /v1/me/decks/:id`
**Query**: `translationLang`. **Response 200**: `DeckDetail`. **403** if not owned by the caller.

### `PATCH /v1/me/decks/:id`
Top-level updates only (`name`, `description`, `language`, `cefrLevel`). Membership has its own endpoints.

**Response 200**: updated `DeckDetail`.

### `DELETE /v1/me/decks/:id`
**Response 204**. Cascades to `deck_vocabularies` only.

### `POST /v1/me/decks/:id/vocabularies`
Append words to the deck. Positions are assigned after the current max.

**Request body**

```json
{ "vocabularyIds": ["uuid-1", "uuid-2", "uuid-3"] }
```

- 1–500 UUIDs.

**Response 201**

```json
{
  "added": 2,
  "alreadyMember": 1,
  "inaccessibleVocabularyIds": ["uuid-foreign"],
  "vocabCount": 52
}
```

### `DELETE /v1/me/decks/:id/vocabularies/:vocabularyId`
**Response 204**. **404** if the word isn't in the deck. Decrements `vocabCount`.

---

## Learning Progress — `/v1/me/progress` and `/v1/me/stats`

Per-user SRS state — SM-2 plus Anki-style **learning steps** (default `1m, 10m`). All endpoints require JWT.

- New cards and lapses cycle through the configured minute-scale steps before reaching the day-scale ladder. A card in step state has `learningStepIndex !== null`; once it graduates the field becomes `null`.
- Day-scale transitions: graduated card → `review` after 3 consecutive correct reps → `mastered` once `intervalDays ≥ 90`.
- A miss on a graduated card drops `learningStepIndex` back to `0` so the card resurfaces within minutes, not the next day.

Env tunables (server-side): `LEARN_LEARNING_STEPS_MINUTES` (default `1,10`), `LEARN_REQUEUE_WINDOW_MINUTES` (default `15` — see `/v1/me/learn/answer`), `LEARN_CLOZE_FAMILY_CAP_PER_LESSON` (default `2` — max cloze-family questions in a word's lesson ladder; see [learn_vocabulary_flow.md](learn_vocabulary_flow.md)).

### `POST /v1/me/progress/enroll`
Add words to the learning queue. Send **exactly one** of `vocabularyIds` or `deckId`. Idempotent — already-enrolled words are skipped.

**Request body (option A — explicit IDs)**

```json
{ "vocabularyIds": ["uuid-1", "uuid-2"] }
```

**Request body (option B — whole deck)**

```json
{ "deckId": "uuid-deck" }
```

**Response 201**

```json
{
  "enrolled": 18,
  "alreadyEnrolled": 2,
  "unknownVocabularyIds": ["uuid-foreign"]
}
```

### `GET /v1/me/progress/due`
Fetch due cards (`nextReviewAt <= now`), oldest-due first.

**Query**: `limit` (default `20`, max `100`), `translationLang`.

**Response 200**: array of cards, each combining the progress row with the full nested vocabulary:

```json
[
  {
    "id": "progress-uuid",
    "vocabularyId": "vocab-uuid",
    "status": "learning",
    "repetitions": 1,
    "easeFactor": 2.5,
    "intervalDays": 1,
    "learningStepIndex": null,
    "nextReviewAt": "2026-05-26T07:00:00.000Z",
    "lastReviewedAt": "2026-05-25T07:00:00.000Z",
    "correctCount": 1,
    "incorrectCount": 0,
    "vocabulary": { /* full Vocabulary with senses[] → translations[] + examples[] */ }
  }
]
```

### `POST /v1/me/progress/review`
Submit a review grade.

**Request body**

```json
{ "vocabularyId": "vocab-uuid", "quality": 4 }
```

- `quality`: integer 0–5. `0–2` = forgot (resets the schedule), `3–5` = remembered.

**Response 201**: updated progress row (no nested vocabulary):

```json
{
  "id": "progress-uuid",
  "vocabularyId": "vocab-uuid",
  "status": "learning",
  "repetitions": 2,
  "easeFactor": 2.5,
  "intervalDays": 6,
  "learningStepIndex": null,
  "nextReviewAt": "2026-06-01T07:00:00.000Z",
  "lastReviewedAt": "2026-05-26T07:00:00.000Z",
  "correctCount": 2,
  "incorrectCount": 0
}
```

`learningStepIndex` is `null` for graduated cards and `0..N-1` for cards currently in the intra-session step ladder; use it to render UI like "step 1 of 2" when present. `nextReviewAt` may be minutes away (step) or days away (graduated) — always trust the timestamp rather than the status.

**404** if the caller is not enrolled in that vocabulary.

### `GET /v1/me/stats`
Home-screen snapshot.

**Response 200**

```json
{
  "streakDays": 5,
  "dueNow": 12,
  "reviewedToday": 8,
  "dailyGoalMinutes": 20,
  "counts": { "new": 3, "learning": 17, "review": 42, "mastered": 6 },
  "nextDueAt": "2026-05-30T03:15:00.000Z"
}
```

`streakDays` counts only if the most recent review date is today or yesterday (UTC days). `nextDueAt` is the ISO timestamp of the soonest progress row scheduled in the future (`next_review_at > now`); use it on the home screen to render "Next review in 3h 20m". Null when the user has no future-scheduled cards — either nothing enrolled yet, or every card is already due (`dueNow > 0` covers that case).

---

## Learn — `/v1/me/learn`

Moved to its own per-feature guide: **[learn_vocabulary_flow.md](learn_vocabulary_flow.md)** — the guided learn-session loop (`POST /v1/me/learn/session`, `POST /v1/me/learn/answer`), the seven question types including the self-rated `flashcard`, the stage-based **lesson ladder**, per-word grouping (`groupId`/`stepIndex`/`stepCount`), and how a word's whole lesson maps to a single SRS event. For the terse contract see [api-endpoints.md](../backend/api-endpoints.md).
