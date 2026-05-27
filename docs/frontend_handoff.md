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

---

## Learn — `/v1/me/learn`

Context-anchored learning sessions. The server picks due cards, generates one question per card from its example sentences, and HMAC-signs each item. Submit each answer separately; the server grades it and feeds the existing SM-2 pipeline.

**Six question types** (discriminated by `prompt.type`):
- `cloze_mcq` — sentence with a blank, 4 word options
- `cloze_typing` — sentence with a blank, free-text answer
- `meaning_in_context` — sentence with highlighted word, 4 translation options (one is the trap from a different sense)
- `sentence_build` — translation prompt, shuffled tokens to arrange
- `sense_disambiguation` — two example sentences side-by-side, match each to its sense's translation
- `listening_cloze` — audio + sentence with a blank, 4 word options

**Type selection** is driven by SRS status: `new`/`learning` → recognition (`cloze_mcq`, `meaning_in_context`); `review` → production (`cloze_typing`, `sentence_build`); `mastered` → `sentence_build` or `sense_disambiguation`. `listening_cloze` is substituted in when audio is available. Types requiring extra data (multiple senses, translation language) are skipped silently if the card lacks it.

### `POST /v1/me/learn/session`
Build a session of N questions for a chosen learning mode. The server's vocab picker selects suitable vocab per mode and, for `daily/topic/deck`, auto-enrolls fresh words into the caller's progress as a side effect (count returned in `enrolledNewlyCount`). `daily` and `topic` require onboarding to be complete; otherwise the server returns `400`.

**Modes**

| `mode` | What it picks | Fresh auto-enrolled? | Required body fields |
|---|---|---|---|
| `daily` | All due cards first, then top up with CEFR-matched fresh vocab in the user's `targetLanguage` (±1 band, sorted by `frequency_rank`) | Yes | `mode` |
| `topic` | Due + fresh vocab tagged with `topicSlug` at the user's CEFR ±1, in `targetLanguage`. Includes the user's own (`source='user'`) vocab tagged with the topic. | Yes | `mode`, `topicSlug` |
| `deck` | Due deck-member cards first, then fresh deck members (in deck position order) | Yes | `mode`, `deckId` |
| `review` | Only already-enrolled, currently-due cards, excluding `status=new` — pure consolidation | **No** | `mode` |

**Request body**

```json
{
  "mode": "daily",
  "limit": 15,
  "translationLang": "vi"
}
```

```json
{ "mode": "topic", "topicSlug": "food", "limit": 10, "translationLang": "vi" }
```

```json
{ "mode": "deck", "deckId": "8c1f7d34-...", "limit": 20, "translationLang": "vi" }
```

```json
{ "mode": "review", "limit": 15, "translationLang": "vi" }
```

`mode` is required. `topicSlug` is required iff `mode=topic`; `deckId` is required iff `mode=deck`. `limit` is clamped to `[1, 50]` (default 15). `translationLang` enables styles that need a target-language translation (`meaning_in_context`, `sentence_build`, `sense_disambiguation`) and provides `hintTranslation` for cloze styles.

**Response 200**

```json
{
  "sessionId": "f3c8a212-7e0b-4b27-9a8e-7e1c1c1d8a2e",
  "mode": "daily",
  "enrolledNewlyCount": 7,
  "emptyReason": null,
  "items": [
    {
      "sessionItemId": "0c2b9f1a-...",
      "vocabularyId": "a4d2...",
      "lemma": "study",
      "exampleId": "7b2e...",
      "type": "cloze_mcq",
      "nonce": "1c8f9b22-...",
      "issuedAtMs": 1748284800000,
      "signature": "9f7e6b3a1c2d...",
      "prompt": {
        "type": "cloze_mcq",
        "sentenceWithBlank": "She _____ biology at university.",
        "hintTranslation": "Cô ấy ___ sinh học ở trường đại học.",
        "audioUrl": "https://cdn.example/audio/study.mp3",
        "options": ["studies", "teaches", "writes", "speaks"]
      }
    }
  ]
}
```

Each item has an envelope (`sessionItemId`, `vocabularyId`, `lemma`, `exampleId`, `type`, `nonce`, `issuedAtMs`, `signature`) plus a typed `prompt`. **Echo `nonce`, `issuedAtMs`, `signature` verbatim** in the answer payload — they prove the item was issued to this user for this card.

#### Empty response (`items: []`)

When the picker finds nothing to learn, `items: []` is returned **with a populated `emptyReason`**:

| `emptyReason` | When | Recommended frontend action |
|---|---|---|
| `no_due_cards` | `mode=review` and the user has progress rows but no card is currently due | Show "All caught up — come back later" |
| `no_enrollment` | `mode=review` and the user has zero progress rows (never enrolled anything) | Suggest switching to Daily / Topic / Deck mode |
| `no_more_at_level` | `mode=daily` or `mode=topic` and there's no due card AND no fresh vocab matches the user's `targetLanguage + CEFR ±1` filter (and topic, for topic mode) | Suggest a different topic or wider CEFR; for daily, the user has likely consumed the catalog at their level |
| `deck_exhausted` | `mode=deck` and every member of the deck is already-enrolled-and-not-yet-due (deck is fully on-schedule) | Show "Deck mastered for now — review later" |

`emptyReason` is always `null` when `items[]` has at least one element.

#### `prompt` shapes by type

**`cloze_mcq`** — show `sentenceWithBlank`, render `options` as 4 buttons. `hintTranslation` and `audioUrl` are nullable.

```json
{ "type": "cloze_mcq", "sentenceWithBlank": "She _____ biology at university.",
  "hintTranslation": "Cô ấy ___ sinh học ở trường đại học.",
  "audioUrl": null, "options": ["studies", "teaches", "writes", "speaks"] }
```

**`cloze_typing`** — show `sentenceWithBlank` + a text input. No `options`.

```json
{ "type": "cloze_typing", "sentenceWithBlank": "I need to _____ for the exam tomorrow.",
  "hintTranslation": "Tôi cần ___ cho kỳ thi ngày mai.", "audioUrl": null }
```

**`meaning_in_context`** — show `sentence`, highlight the substring at `[highlightedSpan.start, highlightedSpan.end)`, render `options` as 4 buttons (translations in `translationLang`).

```json
{ "type": "meaning_in_context",
  "sentence": "Scientists are studying the effects of climate change.",
  "highlightedSpan": { "start": 15, "end": 23 },
  "options": ["nghiên cứu", "học tập", "giảng dạy", "viết ra"] }
```

**`sentence_build`** — show `translation` (L1 prompt), render `tokens` as drag-and-drop tiles in the given (already shuffled) order. User submits the joined sequence.

```json
{ "type": "sentence_build",
  "translation": "Anh ấy đã học tiếng Pháp trong ba năm.",
  "tokens": ["French", "He", "for", "studied", "three", "years"] }
```

**`sense_disambiguation`** — show both `sentences[]` side by side, render the two `options[]` as choices. User picks the option that matches the **first** sentence; the answer should be that option's translation string.

```json
{ "type": "sense_disambiguation",
  "sentences": [
    { "exampleId": "7b2e...", "sentence": "She studies biology at university." },
    { "exampleId": "9d3f...", "sentence": "She studied his face for any sign of emotion." }
  ],
  "options": ["nghiên cứu", "học tập"] }
```

**`listening_cloze`** — play `audioUrl`, show `sentenceWithBlank`, render `options` as 4 buttons.

```json
{ "type": "listening_cloze", "audioUrl": "https://cdn.example/audio/study.mp3",
  "sentenceWithBlank": "He _____ French for three years.",
  "hintTranslation": "Anh ấy đã ___ tiếng Pháp trong ba năm.",
  "options": ["studied", "spoke", "wrote", "taught"] }
```

### `POST /v1/me/learn/answer`
Submit one answer. Server verifies the HMAC + 30-min TTL, re-derives the correct answer, grades the response, and updates the user's SRS state (same SM-2 pipeline as `/v1/me/progress/review`).

**Request body**

```json
{
  "vocabularyId": "a4d2...",
  "type": "cloze_mcq",
  "exampleId": "7b2e...",
  "userAnswer": "studies",
  "latencyMs": 4200,
  "nonce": "1c8f9b22-...",
  "issuedAtMs": 1748284800000,
  "signature": "9f7e6b3a1c2d...",
  "translationLang": "vi",
  "sessionId": "f3c8a212-..."
}
```

`userAnswer` encoding by type:
- `cloze_mcq`, `listening_cloze`, `meaning_in_context`, `sense_disambiguation` — the **string** of the chosen option (not its index)
- `cloze_typing` — the user's typed answer (free text)
- `sentence_build` — the tokens joined by single spaces in the order the user arranged them (e.g. `"He studied French for three years"`)

`translationLang` must match what was sent to `/v1/me/learn/session` — it's part of the HMAC. `sessionId` is optional and ignored by the server. `latencyMs` is the time (ms) between question display and answer submit; the server uses it to choose between quality 5 (fast) and 4 (slow) for correct answers.

**Response 200**

```json
{
  "correct": true,
  "correctAnswer": "studies",
  "quality": 5,
  "progress": {
    "id": "p1...",
    "vocabularyId": "a4d2...",
    "status": "learning",
    "repetitions": 1,
    "easeFactor": 2.6,
    "intervalDays": 1,
    "nextReviewAt": "2026-05-28T08:30:00.000Z",
    "lastReviewedAt": "2026-05-27T08:30:00.000Z",
    "correctCount": 4,
    "incorrectCount": 1
  }
}
```

**Quality mapping** (SM-2 scale 0–5):
- MCQ-style (`cloze_mcq`, `meaning_in_context`, `sense_disambiguation`, `listening_cloze`): correct + fast (`latencyMs ≤ 8000`) → 5; correct + slow → 4; wrong → 2.
- `cloze_typing`: exact match → 5/4 by latency; Levenshtein distance 1 → 3 (not counted as correct); else 2.
- `sentence_build`: exact joined match → 5/4 by latency; same tokens with exactly one swap (2 positions off) → 3; else 2.

**Errors**
- `400` validation (missing/invalid body fields)
- `401` invalid or expired signature (TTL is 30 minutes — refresh by calling `/session` again)
- `404` vocabulary not found, or the user is not enrolled in it (call `/v1/me/progress/enroll` first)
