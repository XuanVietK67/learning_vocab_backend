# Admin — Quick-create a vocabulary from just a lemma (frontend guide)

How the **admin "quick add word" flow** talks to the backend. Instead of hand-filling senses, definitions, and example sentences, the admin types a single word; a background worker enriches it (dictionary + Gemma) into one or more **draft** vocabularies, which the admin then reviews and approves.

- **Endpoints:**
  - `POST /v1/admin/vocabularies/quick` — submit a lemma, get a job back (202)
  - `GET /v1/admin/vocabularies/quick/:jobId` — poll the job until it finishes
  - `POST /v1/admin/vocabularies/:id/approve` — publish a reviewed draft
- **Auth:** `Authorization: Bearer <accessToken>` — the signed-in user must have role `admin`
- **Content type:** `application/json`
- Canonical contract: [api-endpoints.md](api-endpoints.md) · general conventions: [frontend_handoff.md](frontend_handoff.md)

> This is **asynchronous**. The first call returns immediately with a job, *not* a vocabulary. The vocabulary rows appear later, as **unapproved drafts**, once the worker finishes. They are invisible to learners and to the public catalog until approved.

---

## Workflow from the UI

```
[Admin types a word and submits]
        │
        ▼
POST /v1/admin/vocabularies/quick   { lemma, language? }
        │
        └─ 202 → { id (jobId), status: "pending", resultVocabularyIds: [] }
                 │
                 ▼   poll every ~2s
        GET /v1/admin/vocabularies/quick/:jobId
                 │
                 ├─ status "pending"   → keep polling
                 ├─ status "failed"    → show job.error; let the admin retry or fall back to full create
                 └─ status "completed" → resultVocabularyIds = the draft vocab ids
                                          (may be empty if the word already existed)
                 │
                 ▼
        [Show each draft in the review queue]
        GET /v1/admin/vocabularies?isApproved=false   (existing list endpoint)
                 │
                 │  admin edits with the existing PATCH sense/example/translation/topic endpoints
                 ▼
        POST /v1/admin/vocabularies/:id/approve   (per draft)
                 │
                 └─ 200 → vocabulary now published; audio + images generate in the background
```

A single submitted lemma can produce **several** drafts — one per part of speech the dictionary returns (e.g. `run` → a verb draft and a noun draft). Each is approved (or deleted) independently.

---

## 1. Submit — `POST /v1/admin/vocabularies/quick`

### Request

```http
POST /v1/admin/vocabularies/quick HTTP/1.1
Authorization: Bearer <admin-accessToken>
Content-Type: application/json
```

```jsonc
{
  "lemma": "ephemeral",   // required — the word
  "language": "en"        // optional — ISO code, defaults to "en"
}
```

### Field rules

| Field | Required | Type | Rules |
|---|---|---|---|
| `lemma` | yes | string | length 1–128 (trimmed server-side) |
| `language` | no | string | length 2–8, ISO 639-1 (`/^[a-z]{2}(-[A-Z]{2})?$/`), e.g. `en`, `vi`, `pt-BR`. Defaults to `en`. Non-English words skip the dictionary and are enriched by Gemma only (no IPA). |

### Response — `202 Accepted`

```jsonc
{
  "id": "8b1f…",                 // the jobId — poll with this
  "language": "en",
  "lemma": "ephemeral",
  "status": "pending",           // pending | completed | failed
  "resultVocabularyIds": [],     // filled when completed
  "error": null,
  "createdAt": "2026-06-05T10:00:00.000Z",
  "updatedAt": "2026-06-05T10:00:00.000Z"
}
```

**Idempotency:** re-submitting the same `(language, lemma)` while a job is still `pending` returns that **same** job instead of starting a duplicate.

---

## 2. Poll — `GET /v1/admin/vocabularies/quick/:jobId`

Returns the same shape as above. Poll every ~2 seconds until `status` is no longer `pending`.

| `status` | Meaning | What the UI should do |
|---|---|---|
| `pending` | Worker hasn't finished | Keep polling |
| `completed` | Done | `resultVocabularyIds` = the draft ids. If **empty**, every part of speech for this word already existed — tell the admin nothing new was created. |
| `failed` | Enrichment failed (e.g. word not found and Gemma produced nothing) | Show `error`; offer retry or the full create form |

---

## 3. Review the drafts

Drafts are normal vocabulary rows with `isApproved: false`. List them with the existing admin list endpoint, filtered:

```
GET /v1/admin/vocabularies?isApproved=false&q=ephemeral
```

Edit anything that looks off using the existing granular admin endpoints (`PATCH …/senses/:senseId`, `…/examples/:exampleId`, `…/translations/:translationId`, `PUT …/topics`). See [api-endpoints.md](api-endpoints.md).

To **reject** a draft, delete it: `DELETE /v1/admin/vocabularies/:id`.

---

## 4. Approve — `POST /v1/admin/vocabularies/:id/approve`

Publishes one draft. Sets `isApproved: true`, and enqueues background generation of **audio** (if the word has none) and a **per-sense image** (for any sense without one).

### Request

```http
POST /v1/admin/vocabularies/8b1f.../approve HTTP/1.1
Authorization: Bearer <admin-accessToken>
```

(No body.)

### Response — `200 OK`

Returns the full vocabulary object (same shape as `GET /v1/vocabularies/:id`). Note:

- `audioUrl` and per-sense `imageUrl` are usually still **null** in this response — they are generated asynchronously. Re-fetch the word a few seconds later to pick them up.
- Approving is **idempotent**: calling it again on an already-approved word is safe (it just re-checks media).

Once approved, the word immediately becomes eligible for learners' sessions and the public catalog.

---

## Errors

| Status | When | Frontend handling |
|---|---|---|
| 400 | `lemma` missing/too long, or `language` not a valid ISO code | Show field errors |
| 401 | Token missing/expired | Send to login / refresh |
| 403 | Logged in but not `admin` | Hide/disable the screen |
| 404 | `GET quick/:jobId` unknown job, or `approve` on a non-existent system vocabulary | Show "not found"; the draft may have been deleted |

---

## Notes for the frontend

- **Two-phase UX:** submit → poll → review → approve. Don't block the UI waiting for the job; show a spinner/queue and let the admin do other things.
- **One word → many drafts.** Always treat `resultVocabularyIds` as a list and render each draft separately.
- **Empty `resultVocabularyIds` on `completed`** is a success, not an error — it means the word already existed in the catalog.
- **Quality is machine-generated.** The review step exists precisely because dictionary/LLM output can be wrong (especially IPA and example sentences) — encourage admins to skim before approving.
