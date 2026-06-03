# User — Learn vocabulary flow (frontend guide)

How an end user studies vocabulary: the **guided learn-session loop** (the main path) plus the lower-level **progress** endpoints behind it. Covers what the frontend sends, what comes back, how questions are shaped, and how scoring/scheduling works.

**All endpoints require** `Authorization: Bearer <accessToken>` (any signed-in user; no admin role). Content type `application/json`.

| Endpoint | Purpose |
|---|---|
| `POST /v1/me/learn/session` | Start a study session — server picks cards and returns ready-to-render, signed questions. |
| `POST /v1/me/learn/answer` | Submit one answer — server grades it, updates the schedule, and may re-queue the card. |
| `POST /v1/me/progress/enroll` | Add words to the user's study set (usually automatic; see below). |
| `GET /v1/me/progress/due` | Raw list of cards due for review (flashcard-style, client-graded). |
| `POST /v1/me/progress/review` | Submit a self-graded review for one card. |
| `GET /v1/me/stats` | Dashboard numbers: streak, due count, status breakdown. |

Canonical contract: [api-endpoints.md](api-endpoints.md) · conventions: [frontend_handoff.md](frontend_handoff.md)

---

## The learning loop (recommended path)

This is the flow the study screen should use. The server does the picking, question-building, grading, and spaced-repetition scheduling — the client just renders and reports answers.

```
1. POST /v1/me/learn/session   { mode: "daily" }
        │  server picks due + fresh cards, auto-enrolls the fresh ones,
        │  builds one signed question per card
        ▼
   response: { sessionId, items: [ signed question, ... ], emptyReason, nextDueAt }
        │
        ├─ items empty? → show empty-state from `emptyReason`
        │                 (if "no_due_cards", `nextDueAt` says when to return)
        │
        └─ for each item:
              2. render `item.prompt` (switch on prompt.type)
              3. user answers
              4. POST /v1/me/learn/answer  (echo the item's signed fields + userAnswer + latencyMs)
                    ▼
                 response: { correct, correctAnswer, quality, progress, requeue }
                    │
                    └─ requeue != null? → re-show requeue.item at requeue.dueAtMs
                                          (card came due again inside this session)
        │
        └─ items exhausted → session done → optionally GET /v1/me/stats
```

Key idea: **you never manually enroll in this path** — `POST /session` auto-enrolls any brand-new words it picks (`enrolledNewlyCount` tells you how many). Enrollment, grading, and scheduling are side effects of the two learn endpoints.

---

## 1. Start a session — `POST /v1/me/learn/session`

Returns `200 OK`.

### Request body

```jsonc
{
  "mode": "daily",          // required: "daily" | "topic" | "deck" | "review"
  "topicSlug": "travel",    // required iff mode="topic", rejected otherwise
  "deckId": "…uuid…",       // required iff mode="deck", rejected otherwise
  "limit": 15,              // optional, 1..50 (server default 15)
  "translationLang": "vi"   // optional, lang code — language for hints/translation options
}
```

| Field | Required | Rule |
|---|---|---|
| `mode` | ✅ | one of `daily`, `topic`, `deck`, `review` |
| `topicSlug` | only if `mode=topic` | 2–64 chars, `^[a-z0-9-]+$` |
| `deckId` | only if `mode=deck` | UUID v4 |
| `limit` | — | integer 1–50 |
| `translationLang` | — | ISO 639-1 code (`en`, `vi`, `pt-BR`) |

**Modes:** `daily` = mix of due + new at the user's level; `topic` = words in a topic; `deck` = words in a deck; `review` = only cards already due (never enrolls new words, so `enrolledNewlyCount` is always 0).

### Response `200`

```jsonc
{
  "sessionId": "f0e1d2c3-…",
  "mode": "daily",
  "enrolledNewlyCount": 4,         // new words auto-added to the study set by this call
  "emptyReason": null,             // non-null ONLY when items is empty
  "nextDueAt": null,               // ISO ts; set only when emptyReason="no_due_cards"
  "items": [ /* SessionItem[] — see below */ ]
}
```

When `items` is empty, render an empty state from `emptyReason`:

| `emptyReason` | Meaning | Show |
|---|---|---|
| `no_due_cards` | Nothing due right now (uses `nextDueAt`) | "All caught up — come back at `nextDueAt`." |
| `no_more_at_level` | No new words left at the user's level | Suggest raising level / trying a topic. |
| `no_enrollment` | User hasn't enrolled / picked anything yet | Prompt to add words or pick a deck/topic. |
| `deck_exhausted` | Deck fully studied | "You've finished this deck." |

### A session item (signed question)

Every item shares an **envelope** plus a `prompt` whose shape depends on `prompt.type`:

```jsonc
{
  "sessionItemId": "…",       // client correlation id (not signed)
  "vocabularyId": "…uuid…",
  "lemma": "ephemeral",
  "exampleId": "…uuid…",
  "type": "cloze_mcq",        // QuestionType — also the discriminator of `prompt`
  "nonce": "…",               // signed fields ↓ — echo ALL of these back to /answer
  "issuedAtMs": 1717400000000,
  "signature": "…hex…",
  "prompt": { "type": "cloze_mcq", /* type-specific fields */ }
}
```

> ⚠️ **The envelope fields are signed (HMAC) and expire ~30 min after issue.** When you submit an answer you must echo `vocabularyId`, `type`, `exampleId`, `nonce`, `issuedAtMs`, `signature`, and the same `translationLang` you used to create the session. Tampered or stale fields → `401`.

### Question types — render `prompt` by `prompt.type`

There are six types (a discriminated union). Switch on `prompt.type`:

| `type` | Prompt fields | Render | What the user submits as `userAnswer` |
|---|---|---|---|
| `cloze_mcq` | `sentenceWithBlank`, `hintTranslation`, `audioUrl`, `options[]` | Sentence with a blank + multiple-choice options | the chosen option **text** |
| `cloze_typing` | `sentenceWithBlank`, `hintTranslation`, `audioUrl` | Sentence with a blank, free-text input | the typed word |
| `meaning_in_context` | `sentence`, `highlightedSpan {start,end}`, `options[]` | Sentence with a highlighted span + translation options | the chosen option text |
| `sentence_build` | `translation`, `tokens[]` (shuffled) | Drag/tap tokens to build the sentence | the assembled sentence (space-joined) |
| `sense_disambiguation` | `sentences[] [{exampleId, sentence}]`, `options[]` | Two example sentences + two meanings to match | the chosen meaning text |
| `listening_cloze` | `audioUrl`, `sentenceWithBlank`, `hintTranslation`, `options[]` | Play audio, fill the blank (4-option MCQ in v1) | the chosen option text |

The mix of types a card can get widens as the user answers it correctly (recognition → recall → production), gated by data availability — but the frontend doesn't choose; it just renders whatever `type` arrives.

---

## 2. Submit an answer — `POST /v1/me/learn/answer`

Returns `200 OK`. Send the answer plus the signed envelope from the item.

### Request body

```jsonc
{
  "vocabularyId": "…uuid…",     // from the item
  "type": "cloze_mcq",          // from the item
  "exampleId": "…uuid…",        // from the item
  "userAnswer": "fleeting",     // 0..1000 chars — see "submit" column above
  "latencyMs": 4200,            // time the user took, integer >= 0
  "nonce": "…",                 // from the item (signed)
  "issuedAtMs": 1717400000000,  // from the item (signed)
  "signature": "…hex…",         // from the item (signed)
  "translationLang": "vi",      // must match the session's translationLang
  "sessionId": "f0e1d2c3-…"     // optional, client-side correlation only
}
```

### Response `200`

```jsonc
{
  "correct": true,
  "correctAnswer": "fleeting",   // canonical answer — show on reveal, esp. when wrong
  "quality": 5,                  // 0–5 grade the server derived (SM-2 scale)
  "progress": {                  // updated schedule for this card
    "id": "…",
    "vocabularyId": "…uuid…",
    "status": "learning",        // new | learning | review | mastered
    "repetitions": 1,
    "easeFactor": 2.5,
    "intervalDays": 0,
    "learningStepIndex": 1,      // null once graduated to day-scale; else "step i"
    "nextReviewAt": "2026-06-03T08:15:00.000Z",
    "lastReviewedAt": "2026-06-03T08:00:00.000Z",
    "correctCount": 1,
    "incorrectCount": 0
  },
  "requeue": {                   // null most of the time
    "dueAtMs": 1717400600000,    // re-show the card at this wall-clock time
    "item": { /* a fresh signed SessionItem for the same word */ }
  }
}
```

**Handling `requeue`:** when the card's next review lands within ~15 minutes (i.e. it's still being learned this session), the server returns a fresh signed question for the same word. Keep it in your in-session queue and surface it again at `dueAtMs` — typically with a different question `type`. When `requeue` is `null`, the card is scheduled far enough out that a later `POST /session` will bring it back; drop it from the current session.

---

## Alternative: manual flashcard review

If you build your own flashcard UI (client decides right/wrong) instead of the guided loop, use the progress endpoints directly. These are the same primitives the learn loop calls internally.

### `POST /v1/me/progress/enroll` → `200`

Add words to the study set. Provide **either** `vocabularyIds` **or** `deckId` (not both).

```jsonc
{ "vocabularyIds": ["…uuid…", "…uuid…"] }   // 1..500 UUIDs
// or
{ "deckId": "…uuid…" }                       // enroll every word in a deck
```

Response:

```jsonc
{ "enrolled": 8, "alreadyEnrolled": 2, "unknownVocabularyIds": ["…uuid…"] }
```

`unknownVocabularyIds` = ids that don't exist or aren't enrollable by this user (only system words and the caller's own private words can be enrolled). Re-enrolling an already-enrolled word is a no-op (counted in `alreadyEnrolled`).

### `GET /v1/me/progress/due` → `200`

Query params: `limit` (1–100, default 20), `translationLang` (optional lang code). Returns an **array** of due cards, soonest first, each = the `progress` shape above **plus** a full `vocabulary` object (senses/examples/translations):

```jsonc
[
  {
    "id": "…", "vocabularyId": "…", "status": "review",
    "nextReviewAt": "2026-06-03T07:50:00.000Z", "easeFactor": 2.5,
    "repetitions": 3, "intervalDays": 6, "learningStepIndex": null,
    "lastReviewedAt": "…", "correctCount": 5, "incorrectCount": 1,
    "vocabulary": { "id": "…", "lemma": "…", "senses": [ … ] /* VocabularyResponse */ }
  }
]
```

### `POST /v1/me/progress/review` → `200`

Submit a self-graded review. **Quality 0–2 = forgot, 3–5 = remembered.** Returns the updated `progress` object (same shape as in the answer response).

```jsonc
{ "vocabularyId": "…uuid…", "quality": 4 }
```

`404` if the card isn't enrolled — call `/enroll` first.

---

## Dashboard — `GET /v1/me/stats` → `200`

```jsonc
{
  "streakDays": 7,            // consecutive UTC days with ≥1 review (0 if broken)
  "dueNow": 12,               // cards with next_review_at <= now
  "reviewedToday": 23,        // reviews submitted today (UTC)
  "dailyGoalMinutes": 20,     // user's goal, or null if unset
  "counts": { "new": 40, "learning": 12, "review": 30, "mastered": 8 },
  "nextDueAt": "2026-06-03T09:30:00.000Z"   // soonest future card, or null
}
```

---

## Error handling

Standard Nest error shape: `{ "statusCode": 400, "message": "...", "error": "Bad Request" }` (`message` may be a string or an array of strings).

| Status | When | Frontend action |
|---|---|---|
| **401** | Missing/expired JWT; or a learn `/answer` whose signature is **tampered or expired** (`"signature expired"` / `"invalid signature"`) | Refresh the access token. For an expired question signature, fetch a fresh session — don't let users sit on a question >30 min. |
| **400** | Validation error: bad `mode`, missing `topicSlug`/`deckId` for that mode, `enroll` with neither `vocabularyIds` nor `deckId`, empty/unknown deck, out-of-range `quality`/`limit` | Show the field error; fix the request. |
| **404** | `vocabulary not found` (answer), `user not found`, or `not enrolled` on `/progress/review` | For "not enrolled", enroll then retry. |

---

## How scoring & scheduling work (FYI)

Not required to call the API, but explains the numbers:

- **Grading (learn `/answer`):** the server compares `userAnswer` to the expected answer for that question `type` and derives an SM-2 `quality` (0–5). You receive `correct`, the canonical `correctAnswer`, and the `quality` it used. The manual `/review` endpoint instead takes the `quality` you send.
- **Scheduling:** SM-2 (SuperMemo-2) extended with Anki-style **learning steps**. New/lapsed cards step through minute-scale intervals (default `1, 10` min): a wrong answer (`quality < 3`) resets to step 0; a correct answer advances a step, then **graduates** to the day-scale ladder (1 day → 6 days → `interval × easeFactor`). A card reaching a 90-day interval becomes `mastered`. `easeFactor` adjusts on every review.
- **Status** (`new` → `learning` → `review` → `mastered`) is what `counts` and the per-card `status` reflect.
- **Intra-session requeue:** because early intervals are minutes, a just-answered card often comes due again inside the same session — that's the `requeue` field, so the client can re-show it without another `/session` call.

For the implementation see [learn.service.ts](../src/learn/learn.service.ts), [progress.service.ts](../src/progress/progress.service.ts), and the SRS algorithm in [srs.ts](../src/progress/srs.ts).
