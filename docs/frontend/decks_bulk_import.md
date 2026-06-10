# Decks — bulk-import words from a list of lemmas

Paste a list of words into one of your decks. Each word is enriched (dictionary +
AI) into your own private vocabulary and **auto-added to the deck** by a background
worker — so a 50-word list becomes a populated deck without filling 50 forms.

- `POST /v1/me/decks/:id/bulk-import` — start the import — **JWT**
- `GET /v1/me/vocabularies/batches/:batchId` — poll progress — **JWT**

This is the bulk twin of [me_vocabulary_quick_create.md](me_vocabulary_quick_create.md):
same per-word enrichment, but many at once and landing straight into a deck you own.

---

## 1. Start the import — `POST /v1/me/decks/:id/bulk-import`

`:id` is the target deck (must be yours — 403 otherwise).

| Field | Required? | Type | Rules |
|---|---|---|---|
| `lemmas` | yes | string[] | 1–500 items, each 1–128 chars. |
| `language` | no | string | ISO 639-1 (`^[a-z]{2}(-[A-Z]{2})?$`). Defaults to `en`. |
| `translationLanguage` | no | string | ISO 639-1. Target for the per-sense translation generated for every word. Omit → server default; equal to `language` → translation skipped. |

```http
POST /v1/me/decks/8f1d6c2e-3b4a-4c5d-9e0f-1a2b3c4d5e6f/bulk-import
Authorization: Bearer <accessToken>
Content-Type: application/json

{
  "lemmas": ["resilient", "tenacious", "perseverance"],
  "language": "en",
  "translationLanguage": "vi"
}
```

`202 Accepted`:

```json
{
  "batchId": "55555555-5555-5555-5555-555555555555",
  "accepted": 3,
  "skipped": 0
}
```

| Field | Meaning |
|---|---|
| `batchId` | Poll handle. **`null`** when nothing was accepted (every lemma was skipped) — there's nothing to poll. |
| `accepted` | How many lemmas started a job. |
| `skipped` | Lemmas dropped because you already have a pending job for them or already own that word. |

The words are **not** in the deck yet at this point — they appear as each job finishes.

---

## 2. Poll progress — `GET /v1/me/vocabularies/batches/:batchId`

Poll until `pending` reaches `0`. Suggested interval: 1–2s with backoff (a 50-word
batch can take a while since enrichment is rate-limited).

```http
GET /v1/me/vocabularies/batches/55555555-5555-5555-5555-555555555555
Authorization: Bearer <accessToken>
```

`200 OK`:

```json
{
  "batchId": "55555555-5555-5555-5555-555555555555",
  "total": 3,
  "pending": 1,
  "completed": 2,
  "failed": 0,
  "resultVocabularyIds": ["2222...", "3333..."]
}
```

| Field | Meaning |
|---|---|
| `total` | Jobs in the batch (= `accepted` from step 1). |
| `pending` / `completed` / `failed` | Live counts. Done when `pending === 0`. |
| `resultVocabularyIds` | Ids of the words created so far. They are already members of the target deck — re-fetch the deck (`GET /v1/me/decks/:id`) to see them in order. |

### Errors

| Status | When |
|---|---|
| `400` | `lemmas` empty/too long, a bad `language`/`translationLanguage`, or `:id`/`:batchId` not a UUID v4. |
| `401` | Missing/invalid JWT. |
| `403` | The target deck isn't yours (on the import call). |
| `404` | The batch is unknown or not yours (on the poll call). |

### Client notes

- **Deck membership is async.** Don't expect the deck to be full right after the `202`.
  Drive a progress UI off the batch poll, and refresh the deck when `pending` hits `0`
  (or incrementally as `completed` rises).
- A `failed` job means that one lemma produced nothing usable; the rest still land. There's
  no per-lemma error list on the batch — re-submit just the missing words if needed.
- Audio for each created word generates on a separate queue, so `audioUrl` may lag a few
  seconds behind the word appearing in the deck.
