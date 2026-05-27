# Frontend Handoff

Practical reference for frontend engineers integrating with this backend. Lists every HTTP endpoint with what to send, what to expect back, and the minimum context needed to call it. For the canonical, terse contract see [api-endpoints.md](api-endpoints.md); this file mirrors that surface with concrete shapes and examples.

> Keep this file in sync with [api-endpoints.md](api-endpoints.md). Every endpoint that ships in a PR should be reflected here in the same change — see [../CLAUDE.md](../CLAUDE.md).

## Base URL and conventions

- **Base URL (local dev):** `http://localhost:3000` (port via `PORT` env; see [.env.example](../.env.example)).
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
  "createdAt": "2026-05-26T08:30:00.000Z",
  "updatedAt": "2026-05-26T08:30:00.000Z"
}
```

`role` is `"user"` or `"admin"`. Use it to gate admin UI surfaces.

---

## Users — `/v1/users`

All endpoints require JWT and only allow the caller to act on their own user record (`403` otherwise).

### `GET /v1/users/:id`
**Response 200**: `UserResponse` (same shape as `/v1/auth/me`).

### `PATCH /v1/users/:id`
Update onboarding fields. Sending all four flips `isOnboarded` to `true`.

**Request body** (any subset; all optional)

```json
{
  "nativeLanguage": "vi",
  "targetLanguage": "en",
  "proficiencyLevel": "B1",
  "dailyGoalMinutes": 20
}
```

- `dailyGoalMinutes`: integer 5–240.

**Response 200**: updated `UserResponse`.

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
      "senses": [
        {
          "id": "s-001",
          "senseOrder": 1,
          "gloss": "to learn for school/exam",
          "definition": "spend time learning a subject, especially for a test",
          "imageUrl": "https://.../study-learn.jpg",
          "translations": [
            { "id": "t-001", "language": "vi", "translation": "học, học tập", "note": null }
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
          "translations": [
            { "id": "t-002", "language": "vi", "translation": "nghiên cứu, xem xét kỹ", "note": null }
          ],
          "examples": []
        }
      ]
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 542
}
```

A `Vocabulary` always carries one or more **senses** (distinct meanings). `translations[]` and `examples[]` live **inside** a sense — the top-level vocabulary no longer exposes them. Different senses can carry different `imageUrl` values; `audioUrl` lives on the vocabulary (pronunciation is shared across senses). Senses are returned ordered by `senseOrder ASC`.

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
      "translations": [
        { "language": "vi", "translation": "sự tình cờ may mắn" }
      ],
      "examples": [
        { "sentence": "Meeting her was pure serendipity." }
      ]
    }
  ]
}
```

- `senses`: required, 1–16 items. Each sense is `{ gloss?, definition?, imageUrl?, translations?[], examples?[] }`. Order in the request becomes `senseOrder` (1-indexed).

**Response 201**: `Vocabulary` object. **409** if you already own `(language, lemma, partOfSpeech)`.

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

### `POST /v1/admin/vocabularies`
Body identical to `POST /v1/me/vocabularies`, but `source` is `'system'` on the resulting row. **409** on duplicate natural key — use bulk-import for upsert semantics.

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
          "examples": [ { "sentence": "I ate an apple." } ]
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

Per-user SRS state (SM-2). All endpoints require JWT. Status transitions: `new` → `learning` on first review → `review` after 3 correct repetitions in a row → `mastered` once `intervalDays ≥ 90`.

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
  "nextReviewAt": "2026-06-01T07:00:00.000Z",
  "lastReviewedAt": "2026-05-26T07:00:00.000Z",
  "correctCount": 2,
  "incorrectCount": 0
}
```

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
  "counts": { "new": 3, "learning": 17, "review": 42, "mastered": 6 }
}
```

`streakDays` counts only if the most recent review date is today or yesterday (UTC days).
