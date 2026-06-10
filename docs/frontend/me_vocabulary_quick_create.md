# My Vocabularies — quick-create from a lemma

Create one of your own words by typing **just the word**. A background worker
enriches it (dictionary + AI) into a private, auto-approved vocabulary — filling
parts of speech, IPA, definitions, examples, CEFR, a per-sense translation, and
audio — so you don't have to fill the full form.

- `POST /v1/me/vocabularies/quick-create` — start a job — **JWT**
- `GET /v1/me/vocabularies/jobs/:jobId` — poll the job — **JWT**

This is the user-facing twin of the admin quick-create. The difference: the produced
word is **yours** (`source=user`, `visibility=private`, **auto-approved**) — no admin
review step. For the full "I'll supply every sense myself" form, use `POST /v1/me/vocabularies`.

---

## 1. Start the job — `POST /v1/me/vocabularies/quick-create`

| Field | Required? | Type | Rules |
|---|---|---|---|
| `lemma` | yes | string | 1–128 chars. Trimmed server-side. |
| `language` | no | string | ISO 639-1 (`^[a-z]{2}(-[A-Z]{2})?$`). Defaults to `en`. |
| `translationLanguage` | no | string | ISO 639-1. Target for the per-sense translation the worker generates. Omit → server default; equal to `language` → translation skipped. |

```http
POST /v1/me/vocabularies/quick-create
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "lemma": "resilient", "language": "en", "translationLanguage": "vi" }
```

`202 Accepted`:

```json
{
  "id": "33333333-3333-3333-3333-333333333333",
  "language": "en",
  "lemma": "resilient",
  "status": "pending",
  "resultVocabularyIds": [],
  "error": null,
  "createdAt": "2026-06-10T08:30:00.000Z",
  "updatedAt": "2026-06-10T08:30:00.000Z"
}
```

`id` is the **job** id (not a vocabulary id). Submitting the same lemma again while a
job is still `pending` returns that same job instead of starting a duplicate.

---

## 2. Poll the job — `GET /v1/me/vocabularies/jobs/:jobId`

Poll until `status` is `completed` or `failed` (suggested interval: 1–2s, with backoff).

```http
GET /v1/me/vocabularies/jobs/33333333-3333-3333-3333-333333333333
Authorization: Bearer <accessToken>
```

`200 OK` once done:

```json
{
  "id": "33333333-3333-3333-3333-333333333333",
  "language": "en",
  "lemma": "resilient",
  "status": "completed",
  "resultVocabularyIds": ["22222222-2222-2222-2222-222222222222"],
  "error": null,
  "createdAt": "2026-06-10T08:30:00.000Z",
  "updatedAt": "2026-06-10T08:30:07.000Z"
}
```

| `status` | Meaning |
|---|---|
| `pending` | Still enriching. Keep polling. |
| `completed` | Done. `resultVocabularyIds` holds the created word id(s) — one per resolved part of speech. Fetch each via `GET /v1/me/vocabularies/:id`. |
| `failed` | Enrichment produced nothing usable; `error` explains. Nothing was created. |

### Errors

| Status | When |
|---|---|
| `400` | `lemma` missing/too long, or a bad `language`/`translationLanguage` code; or `:jobId` not a UUID v4. |
| `401` | Missing/invalid JWT. |
| `404` | The job doesn't exist **or** belongs to another user. |

### Client notes

- **Audio is async too.** Even after the job is `completed`, the word's `audioUrl` may
  still be null for a few seconds while audio generates on a separate queue — re-fetch the
  vocabulary if you need the audio immediately.
- `resultVocabularyIds` can contain more than one id (e.g. a word that is both a noun and a
  verb). It can also be empty on a `completed` job if every resolved part of speech already
  existed in your words — nothing is duplicated.
