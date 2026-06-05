# Admin — Bulk quick-create from a list or file (frontend guide)

How the **admin "import many words" flow** talks to the backend. The admin (optionally picks a topic, then) pastes a word list or uploads a `.txt` / `.csv` / `.xlsx` / `.pdf` file; the backend parses it into candidate lemmas; the admin curates the list; then each lemma runs through the **same** enrichment pipeline as single quick-create, landing **unapproved drafts** for review — linked to the chosen topic if one was given.

- **Endpoints:**
  - `POST /v1/admin/vocabularies/quick/extract` — parse a file/text → candidate lemmas (no jobs created)
  - `POST /v1/admin/vocabularies/quick/bulk` — enrich a confirmed list → 202 + `batchId`
  - `GET /v1/admin/vocabularies/quick/batch/:batchId` — poll batch progress
- **Auth:** `Authorization: Bearer <accessToken>`, role `admin`
- Builds on single quick-create — read that first: [admin_quick_create_vocabulary.md](admin_quick_create_vocabulary.md). Canonical contract: [api-endpoints.md](api-endpoints.md).

> **Two phases on purpose.** Extraction (especially from a prose PDF) is fuzzy — you get *candidates*, not a clean list. The admin **confirms** the list before any enrichment runs, so you don't spend the (rate-limited) enrichment pipeline on junk. For a clean list/Excel the confirm step is just a preview.

---

## Workflow from the UI

```
[Admin pastes text OR picks a file, chooses mode]
        │
        ▼
POST /v1/admin/vocabularies/quick/extract   (multipart: file? + text? + mode + language)
        │
        └─ 200 { lemmas: [...], stats: {...} }
                 │
        [Show lemmas as an editable checklist; admin unticks junk]
                 │
                 ▼
POST /v1/admin/vocabularies/quick/bulk   { lemmas: [confirmed], language, translationLanguage?, topics? }
        │
        └─ 202 { batchId, accepted, skipped }   (drafts + existing words tagged with topics)
                 │
                 ▼   poll every ~3–5s
        GET /v1/admin/vocabularies/quick/batch/:batchId
        → { total, pending, completed, failed, resultVocabularyIds }
                 │
        [Drafts trickle into the review queue: GET /v1/admin/vocabularies?isApproved=false]
                 │
                 ▼  approve each (or in a loop)
        POST /v1/admin/vocabularies/:id/approve
```

---

## Phase 1 — `POST /v1/admin/vocabularies/quick/extract`

`multipart/form-data`. Send **either** a `file` **or** a `text` field, plus the form fields below.

| Field | Required | Type | Rules |
|---|---|---|---|
| `file` | one of file/text | binary | `.txt`, `.csv`, `.xlsx`, or `.pdf`. Max **5 MB**. |
| `text` | one of file/text | string | Pasted words (or prose). Used when no file is uploaded. |
| `mode` | no | `list` \| `prose` | Default `list`. Use `prose` for running text/articles (tokenises words, strips common stopwords). `list` keeps each line/cell/comma-separated entry as-is (multi-word phrases preserved). |
| `language` | no | string | ISO code, default `en`. Drives which catalog words are filtered out. |

### Example (curl)

```bash
curl -X POST https://api.example.com/v1/admin/vocabularies/quick/extract \
  -H "Authorization: Bearer <admin-token>" \
  -F "file=@words.xlsx" \
  -F "mode=list" \
  -F "language=en"
```

### Response — `200 OK`

```jsonc
{
  "lemmas": ["ephemeral", "serendipity", "ubiquitous"],
  "stats": {
    "extracted": 42,          // raw tokens/cells found
    "deduped": 7,             // duplicates collapsed (case-insensitive)
    "removedStopwords": 18,   // prose mode only; common words dropped
    "alreadyInCatalog": 14,   // candidates already in the system catalog, removed
    "capped": false           // true if the list was truncated to 1000
  }
}
```

`lemmas` is the **candidate** list for the admin to review. It's already deduped and stripped of words already in the catalog — but for prose especially, expect noise the admin should untick.

**Errors:** 400 if neither file nor text is provided, the file type is unsupported, or `mode`/`language` are invalid. 413 if the file exceeds 5 MB.

---

## Phase 2 — `POST /v1/admin/vocabularies/quick/bulk`

Send the **confirmed** lemmas as JSON.

```jsonc
{
  "lemmas": ["ephemeral", "serendipity", "ubiquitous"],  // 1–500
  "language": "en",                                       // optional, default en
  "translationLanguage": "vi",                            // optional, default vi
  "topics": ["academic"]                                  // optional topic slugs
}
```

| Field | Required | Type | Rules |
|---|---|---|---|
| `lemmas` | yes | string[] | 1–500 items, each 1–128 chars |
| `language` | no | string | ISO code, default `en` |
| `translationLanguage` | no | string | ISO code (same regex as `language`). Target language for the per-sense translation Gemma adds to **every** lemma in the batch. Omitted → server default (`vi`); set equal to `language` to skip translation. |
| `topics` | no | string[] | 0–32 topic slugs, each `[a-z0-9-]+`, 1–64 chars. **Must already exist** in the topic catalog (`GET /v1/topics`) — any unknown slug fails the whole request with **400**. |

### Response — `202 Accepted`

```jsonc
{
  "batchId": "9c2e…",   // null if every lemma was skipped
  "accepted": 2,         // jobs created
  "skipped": 1           // already had a pending job or an existing system vocab
}
```

The backend re-dedupes and skips lemmas that already have a pending job or an existing system word — so re-submitting the same list is cheap and safe.

**Topics (pick a topic, then paste the list).** When you send `topics`, the chosen slugs are attached to **every** word the submission touches:

- Each **newly created draft** is linked to the topic(s) as it's enriched (the link rides along on the background job).
- Any lemma that was **skipped because it already exists** as a system word is still **tagged in place** (tag-on-skip) — so an existing word in your list lands in the topic too, even though it doesn't show up in `accepted` or in the batch's `resultVocabularyIds`.

So `topics` is *additive and idempotent*: re-submitting a list to add a topic is safe, and words already carrying that topic aren't duplicated. The link is the same one `PUT /v1/admin/vocabularies/:id/topics` manages, so you can still adjust per-word topics during review.

---

## Phase 3 — `GET /v1/admin/vocabularies/quick/batch/:batchId`

Poll every ~3–5 seconds (each lemma is enriched in the background, paced by the enrichment worker's rate limit — a large batch fills gradually).

```jsonc
{
  "batchId": "9c2e…",
  "total": 2,
  "pending": 1,
  "completed": 1,
  "failed": 0,
  "resultVocabularyIds": ["…"]   // draft vocab ids produced so far (one+ per completed lemma)
}
```

When `pending` reaches 0 the batch is done. Drafts are normal unapproved rows — review them via `GET /v1/admin/vocabularies?isApproved=false` and publish with `POST /v1/admin/vocabularies/:id/approve` (see [admin_quick_create_vocabulary.md](admin_quick_create_vocabulary.md)). **404** if the `batchId` is unknown.

---

## Notes & limits for the frontend

- **Two-step UX is mandatory** — extract → confirm → enrich. Never auto-submit the raw extract output, especially for PDFs.
- **`mode` matters.** A word-list file/paste → `list`. An article/prose PDF → `prose` (otherwise you'd import every word including all the connective tissue).
- **Caps:** 5 MB file, 1000 candidates per extract, 500 lemmas per bulk submit. If `stats.capped` is true, tell the admin the list was truncated.
- **Throughput:** enrichment is rate-limited (shared Gemma key). A 200-word batch can take many minutes — show the progress bar from the batch endpoint; drafts appear gradually, not all at once.
- **Quality is machine-generated** and **not lemmatised** ("running" imports as "running", not "run"). The confirm step + per-draft review are where quality is enforced.
