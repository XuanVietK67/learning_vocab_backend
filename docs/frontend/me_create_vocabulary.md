# My Vocabulary — ways a user can add a word (frontend guide)

Everything the **end-user "add a word" / "build my word list" surface** needs to
talk to the backend. A signed-in user has **three** ways to create their own
words. **Quick-create is the primary path** — the default "Add word" action —
because the user only types the word and the backend fills the rest. The manual
full form is kept as an **advanced / fallback** path (see why below).

| # | Way | Role in the UI | Endpoint | Effort | Sync? |
|---|---|---|---|---|---|
| 1 | **Quick-create one word** | **Default "Add word"** | `POST /v1/me/vocabularies/quick-create` | type just the lemma | ⏳ `202` + poll job |
| 2 | **Quick-create a list (bulk)** | Bulk action on a deck | `POST /v1/me/decks/:id/bulk-import` | paste many lemmas | ⏳ `202` + poll batch |
| 3 | **Manual, full form** | **Advanced / fallback** | `POST /v1/me/vocabularies` | type every field | ✅ instant `201` |

All three create **user-owned** words: `source: "user"`, **private**, owned by the
caller, and **auto-approved** (usable immediately — no admin review). Ways 1 & 2 run
an async enrichment worker (dictionary + AI) and also auto-generate audio.

- **Auth (all):** `Authorization: Bearer <accessToken>` — any signed-in user.
- Canonical contract: [api-endpoints.md](../backend/api-endpoints.md) · conventions: [frontend_handoff.md](frontend_handoff.md) · screen/flow overview: [user_vocab_lists_design.md](user_vocab_lists_design.md)

> **How to present these in the UI**
> - The "Add word" entry point defaults to **Quick add** (just type the word →
>   Way 1). This is the path the user reaches for 90% of the time.
> - Offer an **"Advanced / fill it myself"** toggle that opens the full form
>   (Way 3). Don't make it the first thing the user sees.
> - **"Bulk import"** (Way 2) lives on a deck the user owns (its `⋯` menu), since
>   the pasted words land directly in that deck.
>
> **Why keep the manual form at all (don't delete it):**
> 1. **Fallback when quick-create can't help** — for an unknown/niche word, a typo,
>    or a proper noun, the job returns `failed` or `completed` with **empty**
>    `resultVocabularyIds`. The manual form is then the only way to add that word.
> 2. **The only way to author custom sense content** — `PATCH /v1/me/vocabularies/:id`
>    updates **top-level fields only**; senses, translations, and examples can't be
>    edited after the fact. So a user who wants their own definition / example /
>    translation must use the full form.
> 3. **Personalization** — quick-create produces generic content; the form lets the
>    user write exactly what they want.
>
> A good flow: user quick-adds → if it `fails`/comes back empty, surface
> **"Add it manually"** that opens the full form pre-filled with the lemma.

---
---

# Way 1 — Quick-create one word (lemma only) — **primary**

> Full per-feature contract: [me_vocabulary_quick_create.md](me_vocabulary_quick_create.md). Summary below.

- **Start:** `POST /v1/me/vocabularies/quick-create`
- **Poll:** `GET /v1/me/vocabularies/jobs/:jobId`

The user types **just the word**; a background worker enriches it (dictionary +
AI) into a private, auto-approved vocabulary — parts of speech, IPA, definitions,
examples, CEFR, a per-sense translation, and audio — so they don't fill the full
form. **Asynchronous**: the API returns `202` immediately and the UI polls.

## Start the job

| Field | Required? | Type | Rules |
|---|---|---|---|
| `lemma` | ✅ | string | 1–128 chars (trimmed server-side) |
| `language` | — | string | ISO 639-1 (`^[a-z]{2}(-[A-Z]{2})?$`); defaults to `en` |
| `translationLanguage` | — | string | ISO 639-1; target for the generated translation. Omit → server default; equal to `language` → translation skipped |

```http
POST /v1/me/vocabularies/quick-create
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "lemma": "resilient", "language": "en", "translationLanguage": "vi" }
```

`202 Accepted` → an enrichment **job** (note: `id` is the *job* id, not a word id):

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

Re-submitting the same lemma while a job is still `pending` returns that same job
instead of starting a duplicate.

## Poll the job

Poll `GET /v1/me/vocabularies/jobs/:jobId` until `status` is `completed` or
`failed` (1–2s interval with backoff).

| `status` | Meaning |
|---|---|
| `pending` | Still enriching — keep polling. |
| `completed` | Done. `resultVocabularyIds` holds the created word id(s) — **one per resolved part of speech**. Fetch each via `GET /v1/me/vocabularies/:id`. Can be **empty** if every resolved POS already existed in your words (nothing duplicated → show "You already have this word"). |
| `failed` | Enrichment produced nothing usable; `error` explains. Nothing was created. |

| Status | When |
|---|---|
| `400` | bad `lemma`/`language`/`translationLanguage`, or `:jobId` not a UUID v4 |
| `401` | missing/invalid JWT |
| `404` | job doesn't exist **or** isn't owned by the caller |

## UI notes

- **Non-blocking.** Show an inline "⏳ enriching…" row and let the user keep
  working; the finished word streams into My Words. (See B1/B2 wireframes in
  [user_vocab_lists_design.md](user_vocab_lists_design.md).)
- **`failed` or empty result → offer the manual fallback.** On `failed`, or
  `completed` with empty `resultVocabularyIds` that the user *expected* to be a new
  word, surface **"Add it manually"** → opens Way 3's form pre-filled with the lemma.
- **Audio lags** even after `completed` (separate queue) — don't block on `audioUrl`.

---
---

# Way 2 — Quick-create a list (bulk-import into a deck)

> Full per-feature contract: [decks_bulk_import.md](decks_bulk_import.md). Summary below.

- **Start:** `POST /v1/me/decks/:id/bulk-import`  (`:id` = a deck the user owns)
- **Poll:** `GET /v1/me/vocabularies/batches/:batchId`

Paste a **list of words**; each is enriched (same worker as Way 1) into the user's
own private vocabulary and **auto-added to the target deck** — so a 50-word list
becomes a populated deck without filling 50 forms. **Asynchronous**: `202` + poll.

> The list lands **in a deck**, so the user must pick/create a deck first. There is
> no standalone "bulk add to My Words without a deck" endpoint — if you want a
> generic bulk add, target a default/"Inbox" deck.

## Start the import

| Field | Required? | Type | Rules |
|---|---|---|---|
| `lemmas` | ✅ | string[] | **1–500** items, each 1–128 chars |
| `language` | — | string | ISO 639-1; defaults to `en` |
| `translationLanguage` | — | string | ISO 639-1; per-word translation target. Omit → default; equal to `language` → skipped |

```http
POST /v1/me/decks/8f1d6c2e-3b4a-4c5d-9e0f-1a2b3c4d5e6f/bulk-import
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "lemmas": ["resilient", "tenacious", "perseverance"], "language": "en", "translationLanguage": "vi" }
```

`202 Accepted`:

```json
{ "batchId": "55555555-5555-5555-5555-555555555555", "accepted": 3, "skipped": 0 }
```

| Field | Meaning |
|---|---|
| `batchId` | Poll handle. **`null`** when nothing was accepted (every lemma skipped) — nothing to poll. |
| `accepted` | How many lemmas started a job. |
| `skipped` | Lemmas dropped because you already have a pending job for them or already own that word. |

The words are **not** in the deck yet at this point — they appear as each job finishes.

## Poll progress

Poll `GET /v1/me/vocabularies/batches/:batchId` until `pending === 0`
(1–2s with backoff; a big batch is slow because enrichment is rate-limited).

```json
{
  "batchId": "55555555-5555-5555-5555-555555555555",
  "total": 3, "pending": 1, "completed": 2, "failed": 0,
  "resultVocabularyIds": ["2222...", "3333..."]
}
```

- Drive a progress bar from `completed / total`; surface `failed`. Done at `pending === 0`.
- `resultVocabularyIds` are already members of the deck — re-fetch the deck
  (`GET /v1/me/decks/:id`) to show them in order.

| Status | When |
|---|---|
| `400` | `lemmas` empty/too long, bad `language`/`translationLanguage`, or `:id`/`:batchId` not a UUID v4 |
| `401` | missing/invalid JWT |
| `403` | the target deck isn't yours (on the import call) |
| `404` | batch unknown or not yours (on the poll call) |

## UI notes

- **Deck fills async.** Refresh the deck when `pending` hits `0` (or incrementally
  as `completed` rises). Offer a "run in background" dismiss + completion toast.
- **`accepted === 0`** (all skipped, `batchId: null`) → inline note "All of these
  are already in your words", no progress view.
- **`failed`** counts a lemma that produced nothing; the rest still land. No
  per-lemma error list — re-submit just the missing words. Audio lags as usual.
  (See C1/C2 wireframes in [user_vocab_lists_design.md](user_vocab_lists_design.md).)

---
---

# Way 3 — Manual, full form — **advanced / fallback**

- **Endpoint:** `POST /v1/me/vocabularies`
- **Content type:** `application/json`

The full-control path: the user types the word header, every sense, and each
sense's translations and examples. The word is created the moment you call it.

> **Don't make this the default** — it's many inputs. Reach for it only when:
> the user wants full control over the content, or quick-create (Way 1) returned
> `failed` / an empty result. Open it pre-filled with the lemma the user already typed.

## Workflow from the UI

```
[User opens "Advanced / fill it myself" (or arrives from a failed quick-create)]
        │
        │  validate client-side (see "Field rules")
        ▼
POST /v1/me/vocabularies   (Bearer token + JSON body)
        │
        ├─ 401 → token missing/expired → refresh / send to login
        ├─ 400 → validation or unknown topic slug → show field errors
        ├─ 409 → you already have this (language, lemma, partOfSpeech) → offer to open it
        │
        └─ 201 → success → returns the full word object
                 │
                 ├─ it now appears in "My Words" (GET /v1/me/vocabularies)
                 └─ audioUrl is null for now (generated in background).
                    Re-fetch the word later to get the audio URL.
```

The whole feature is **a single request**. There is no multi-step wizard on the
API side — the word header, all of its senses, and each sense's translations and
examples are sent in one body and saved together **atomically**: if any part is
invalid, nothing is saved.

## Request

### Headers

```http
POST /v1/me/vocabularies HTTP/1.1
Authorization: Bearer <accessToken>
Content-Type: application/json
```

### Body shape

```jsonc
{
  "language": "en",                 // required — the word's language
  "lemma": "resilient",             // required — the word itself
  "partOfSpeech": "adjective",      // required — enum (see below)
  "ipa": "/rɪˈzɪliənt/",            // optional
  "cefrLevel": "B2",                // optional — A1..C2
  "frequencyRank": 4821,            // optional — integer >= 0
  "audioUrl": null,                 // optional — omit to auto-generate audio
  "topics": ["psychology"],         // optional — existing topic slugs

  "senses": [                       // required — 1..16 senses
    {
      "gloss": "able to recover",   // optional — short label
      "definition": "Able to recover quickly from difficulties.", // optional
      "imageUrl": null,             // optional
      "synonyms": ["tough", "hardy"],         // optional
      "antonyms": ["fragile"],      // optional
      "translations": [             // optional — 0..16
        { "language": "vi", "translation": "kiên cường", "note": null, "source": "manual" }
      ],
      "examples": [                 // required — MINIMUM 2 per sense
        { "sentence": "She is remarkably resilient.", "translation": "Cô ấy kiên cường đến đáng kinh ngạc." },
        { "sentence": "A resilient economy bounces back fast." }
      ]
    }
  ]
}
```

### Field rules (validate these client-side before sending)

The backend rejects anything that breaks these with `400`. Enforcing them in the
form gives faster feedback and avoids a round-trip.

| Field | Required | Rule |
|---|---|---|
| `language` | ✅ | ISO 639-1 code, regex `^[a-z]{2}(-[A-Z]{2})?$` (e.g. `en`, `vi`, `pt-BR`), 2–8 chars |
| `lemma` | ✅ | 1–128 chars |
| `partOfSpeech` | ✅ | one of: `noun`, `verb`, `adjective`, `adverb`, `pronoun`, `preposition`, `conjunction`, `interjection`, `phrase`, `other` |
| `ipa` | — | 1–128 chars |
| `cefrLevel` | — | one of `A1`, `A2`, `B1`, `B2`, `C1`, `C2` |
| `frequencyRank` | — | integer ≥ 0 |
| `audioUrl` | — | 1–512 chars. **Omit it to have audio auto-generated.** |
| `topics` | — | up to 32 slugs, each `^[a-z0-9-]+$`; **each must be an existing system topic** (unknown slug → `400`) |
| `senses` | ✅ | **1–16** items |
| `senses[].gloss` | — | 1–128 chars |
| `senses[].definition` | — | 1–2000 chars |
| `senses[].imageUrl` | — | 1–512 chars |
| `senses[].synonyms` / `antonyms` | — | up to 32 items, each 1–64 chars |
| `senses[].translations` | — | up to 16; each needs `language` (lang code) + `translation` (1–255 chars); `note` (≤2000) and `source` (≤32) optional |
| `senses[].examples` | ✅ | **2–16** items; each needs `sentence` (1–1000 chars); `translation` (≤1000) and `source` (≤32) optional |

> ⚠️ **The two most common form mistakes:** (1) sending only **one** example per
> sense — the minimum is **2** (the extra example is held out as a hidden test
> sentence by the learning module); (2) sending a **topic slug that doesn't
> exist** — only offer existing slugs in the picker (fetch from `GET /v1/topics`).
>
> Also: the global validation **rejects unknown fields**, so don't send extra keys
> the form doesn't use.

## Response

### `201 Created`

Returns the complete, hydrated word (same shape as `GET /v1/me/vocabularies/:id`):

```json
{
  "id": "8f1d2c34-5b6a-4c7d-8e9f-0a1b2c3d4e5f",
  "language": "en",
  "lemma": "resilient",
  "partOfSpeech": "adjective",
  "ipa": "/rɪˈzɪliənt/",
  "cefrLevel": "B2",
  "frequencyRank": 4821,
  "audioUrl": null,
  "source": "user",
  "enrichmentStatus": null,
  "senses": [
    {
      "id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      "senseOrder": 1,
      "gloss": "able to recover",
      "definition": "Able to recover quickly from difficulties.",
      "imageUrl": null,
      "synonyms": ["tough", "hardy"],
      "antonyms": ["fragile"],
      "translations": [
        { "id": "…", "language": "vi", "translation": "kiên cường", "note": null, "source": "manual" }
      ],
      "examples": [
        { "id": "…", "sentence": "She is remarkably resilient.", "translation": "Cô ấy kiên cường đến đáng kinh ngạc.", "source": "manual" },
        { "id": "…", "sentence": "A resilient economy bounces back fast.", "translation": null, "source": "manual" }
      ]
    }
  ],
  "topics": [
    { "slug": "psychology", "name": "Psychology", "description": null, "iconUrl": null }
  ]
}
```

Notes for the UI:

- **`source` is `"user"`** — this is the caller's private word. It shows up in
  **My Words** right away and is immediately usable for learning/practice (no
  approval step).
- **`id`** — newly generated UUID; use it to navigate to the word's detail/edit page.
- **`audioUrl` is `null` right away.** Audio is generated by a background worker.
  To show audio, **re-fetch the word** (`GET /v1/me/vocabularies/:id`) a little
  later, or refresh on the detail page — don't expect it in this response.
- **`enrichmentStatus` is `null`** for manually-created words (it's only set on the
  quick-create / enrichment path).
- **`senseOrder`** is assigned by the server (1-based), in the order you sent the senses.
- **`topics`** comes back sorted by slug, each as a full topic object (not just the slug).
- Translation/example `source` defaults to `"manual"` when you don't send one.

## Error handling

Standard Nest error shape:

```json
{ "statusCode": 400, "message": ["senses.0.examples must contain at least 2 elements"], "error": "Bad Request" }
```

| Status | Meaning | What the frontend should do |
|---|---|---|
| **401** | No / expired / invalid token | Trigger token refresh or send the user to login. |
| **400** | A field broke validation, an unknown body field was sent, or a `topics` slug doesn't exist | Map `message` to the offending field(s) and show inline errors. |
| **409** | **You** already have a word with the same `(language, lemma, partOfSpeech)` | Tell the user it's a duplicate of one of their words; offer to open the existing one instead. Scoped to the caller — another user having the same word does not conflict. |

`message` is sometimes a string and sometimes an array of strings — handle both.

## Suggested form layout

A single scrollable form (or a stepper if you prefer), saved with one **Save**
button. Structure mirrors the body: a **word header** block, then a repeatable
**sense** block, each containing repeatable **translation** and **example** rows.

```
← Back                        Add a word                 [ Save ]

┌─ Word ─────────────────────────────────────────────────────┐
│ Word (lemma) *  [ resilient                              ]  │
│ Language *      [ English (en) ▾ ]   Part of speech * [adj ▾]│
│ IPA             [ /rɪˈzɪliənt/        ]  CEFR [ B2 ▾ ]       │
│ Frequency rank  [ 4821 ]   Topics [ psychology ✕ ] [+ add]  │
│ Audio           ◉ Auto-generate   ○ Paste URL [          ]  │
└────────────────────────────────────────────────────────────┘

┌─ Sense 1 ───────────────────────────────────────  [⋯][✕] ┐
│ Gloss        [ able to recover                          ]  │
│ Definition   [ Able to recover quickly from… (2000)     ]  │
│ Image        [ upload / paste URL — optional            ]  │
│ Synonyms     [ tough ✕ ] [ hardy ✕ ] [+ add]              │
│ Antonyms     [ fragile ✕ ] [+ add]                        │
│                                                            │
│  Translations (optional)                                   │
│   ┌──────────────────────────────────────────────────┐    │
│   │ [vi ▾]  [ kiên cường         ]  note [        ] ✕ │    │
│   └──────────────────────────────────────────────────┘    │
│   [+ add translation]                                      │
│                                                            │
│  Examples *  (at least 2)                                  │
│   ┌──────────────────────────────────────────────────┐    │
│   │ 1. [ She is remarkably resilient.            ] ✕  │    │
│   │    translation [ Cô ấy kiên cường…           ]    │    │
│   ├──────────────────────────────────────────────────┤    │
│   │ 2. [ A resilient economy bounces back fast.  ] ✕  │    │
│   └──────────────────────────────────────────────────┘    │
│   [+ add example]                                          │
└────────────────────────────────────────────────────────────┘

[ + Add another sense ]
```

Layout / UX rules that fall directly out of the contract:

- **Word header.** `lemma`, `language`, `partOfSpeech` are the three required
  fields — keep them at the top and block Save until they're filled. `partOfSpeech`
  and `cefrLevel` are fixed enums → use dropdowns, never free text.
- **Audio.** Default the control to **Auto-generate** (omit `audioUrl` from the
  body). Only send `audioUrl` if the user explicitly pastes one. After Save, show
  the speaker as "processing" and light it up on a later re-fetch — never block the
  form on audio.
- **Topics picker.** Must be a picker backed by existing slugs from
  `GET /v1/topics`. Do **not** let users type arbitrary slugs — an unknown slug is
  a `400`. Hide this field entirely if you don't want users assigning topics.
- **Senses repeater.** Start with **one** sense expanded. Allow add/remove (1–16).
  Each sense is independent; `senseOrder` is decided by send order, so let the user
  reorder before saving if you support it.
- **Examples repeater — enforce the minimum of 2.** Seed every new sense with
  **two** empty example rows and disable removing below two. This is the single
  most common `400`; catch it client-side. Cap at 16.
- **Translations repeater.** Optional, 0–16 per sense. Each row = a language
  dropdown + translation text + optional note. Default the language dropdown to the
  user's native language for convenience.
- **Synonyms / antonyms.** Tag-style inputs, up to 32 each, 1–64 chars per tag.
- **Character counters** on `definition` (2000), `examples[].sentence` (1000),
  `translations[].translation` (255), and `note` (2000) to pre-empt length `400`s.
- **Atomic save.** One request saves everything; if it `400`s, keep the whole form
  populated and map `message` paths (e.g. `senses.0.examples`) back to the right
  sense/row. Don't clear the form on error.
- **Duplicate (409).** Surface inline near the word header ("You already have this
  word") with a link to open the existing entry, rather than a generic toast.

## What the backend does (FYI)

1. The guard checks the JWT (`401`).
2. The body is validated against the rules above (`400`).
3. It checks whether **this user** already owns a word with the same
   `(language, lemma, partOfSpeech)` → `409` if so.
4. In a single DB transaction it writes the vocabulary (as `source: user`, private,
   owned by the caller), its senses, each sense's translations and examples, and
   the topic links. If any step fails, the whole thing rolls back.
5. After commit, if you didn't supply `audioUrl`, it queues a background
   audio-generation job (keyed by the word id, so it won't duplicate). A queue
   outage never fails the request.
6. It returns the freshly re-read, fully-populated word.

Service: [vocabularies.service.ts](../../src/vocabularies/vocabularies.service.ts) (`createUserVocabulary`).

---

## Cross-cutting (all three ways)

- **Where words land.** Ways 1 & 3 → **My Words** (`GET /v1/me/vocabularies`).
  Way 2 → the target **deck** (and also My Words). All are `source: user`, private,
  auto-approved.
- **Manual is the safety net.** Quick-create (Way 1) and bulk (Way 2) can fail or
  return nothing for unknown/niche words; the manual form (Way 3) is the fallback
  that always works. Wire a "Add it manually" path from a failed quick-create.
- **Audio is always late.** Every path generates audio on a separate queue; render
  the word first and light up the speaker when `audioUrl` arrives on a later fetch.
- **Async ways share one progress pattern.** Ways 1 & 2 both return `202` and are
  polled (job vs. batch). Build one reusable "enrichment progress" component.
- **Validation echoes the contract.** Lemma 1–128; up to 500 per bulk import;
  language codes `^[a-z]{2}(-[A-Z]{2})?$`; CEFR `A1–C2`. Validate client-side to
  avoid round-trip `400`s.
