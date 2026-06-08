# User — Learn session UI flow (screen-by-screen)

The end-to-end journey a **normal signed-in user** takes to study vocabulary, written for the frontend that has to build the screens: from **picking a vocabulary source**, through **rendering the question types**, to **what happens after the session finishes**.

This doc is the *journey/state* view. For the exact request/response field tables, validation rules, and error codes of each endpoint, see the contract doc: **[learn_vocabulary_flow.md](learn_vocabulary_flow.md)**. Shared conventions (base URL, auth header, pagination, error shape) live in **[frontend_handoff.md](frontend_handoff.md)**.

**Auth:** every call below needs `Authorization: Bearer <accessToken>` (any user; no admin role). Content type `application/json`.

---

## The whole journey at a glance

```
┌─────────────┐   GET /v1/me/stats           ┌──────────────────────┐
│  Home /     │ ───────────────────────────▶ │  Pick a source        │
│  Dashboard  │   streak, dueNow, counts     │  (choose a "mode")    │
└─────────────┘                              └──────────┬───────────┘
                                                        │
        ┌───────────────────────────────────────────────┼──────────────────────────────┐
        │ daily / review            │ topic                │ deck                         │
        │ (no list needed)          │ GET /v1/topics       │ GET /v1/me/decks/suggested   │
        │                           │ → user picks a topic │ GET /v1/decks (catalog)      │
        │                           │                      │ GET /v1/me/decks (own)       │
        └───────────────────────────┴──────────┬───────────┴──────────────────────────────┘
                                                │  user has chosen mode (+ topicSlug / deckId)
                                                ▼
                                  POST /v1/me/learn/session
                                  { mode, topicSlug?, deckId?, limit?, translationLang? }
                                                │
                        ┌───────────────────────┴───────────────────────┐
                        │ items === []                                   │ items.length > 0
                        ▼                                                ▼
                ┌───────────────┐                            ┌────────────────────────┐
                │ Empty state    │                            │  Question runner        │
                │ (emptyReason)  │                            │  render items in order  │
                └───────────────┘                            └───────────┬────────────┘
                                                                         │ for each item:
                                                                         │  render prompt → user answers
                                                                         │  POST /v1/me/learn/answer
                                                                         │  show feedback (correct/correctAnswer)
                                                                         │  if requeue → re-enqueue at dueAtMs
                                                                         ▼
                                                              ┌────────────────────────┐
                                                              │  Session complete       │
                                                              │  summary + GET /me/stats │
                                                              └────────────────────────┘
```

The server does all the picking, question-building, grading, and scheduling. The client's job is: **let the user choose a source → POST one session → render/report each question → show a finish screen.**

---

## Step 0 — Home / dashboard

Before the user starts, the home screen typically shows their study state. One call:

- **`GET /v1/me/stats`** → `{ streakDays, dueNow, reviewedToday, dailyGoalMinutes, counts: {new,learning,review,mastered}, nextDueAt }`.

Use it to drive the primary CTA:
- `dueNow > 0` → **"Review N cards"** (suggest `mode: "review"` or `mode: "daily"`).
- `dueNow === 0` and `nextDueAt` set → **"All caught up — next review at `nextDueAt`"**, but still let the user start a `daily`/`topic`/`deck` session to learn *new* words.

---

## Step 1 — Pick a vocabulary source (choose a `mode`)

"Vocabulary source" maps directly to the session `mode`. There are four. **`daily` and `review` need no list call** — the server picks for the user. `topic` and `deck` need a selection UI, and that's where the **list APIs** come in.

| Source the user picks | `mode` | Extra field to collect | List API to populate the picker |
|---|---|---|---|
| **Daily mix** (due + new at their level) | `daily` | — | none |
| **Review only** (cards already due) | `review` | — | none (gate the button on `dueNow > 0` from stats) |
| **A topic** | `topic` | `topicSlug` | `GET /v1/topics` → list of `{ slug, name, iconUrl, … }`; user taps one → use its `slug` |
| **A deck** | `deck` | `deckId` | `GET /v1/me/decks/suggested` (recommended for the user), `GET /v1/decks` (system catalog, paginated), and/or `GET /v1/me/decks` (the user's own decks) → user taps one → use its `id` |

Notes for the source-selection screens:
- **Topic picker:** `GET /v1/topics` returns a flat array (no pagination — the set is small). Show `name` + `iconUrl`; pass the chosen `slug` as `topicSlug`.
- **Deck picker:** prefer `GET /v1/me/decks/suggested` for the headline row (decks matching the user's `targetLanguage` + `proficiencyLevel`; empty array if onboarding is incomplete). Fall back to the paginated catalog `GET /v1/decks` and the user's own `GET /v1/me/decks`. Each deck summary carries `vocabCount` so you can show "50 words". Pass the chosen deck's `id` as `deckId`.
- **Browse-to-build (optional):** if you also let users hand-pick words (e.g. from `GET /v1/vocabularies`) into a personal deck first, that's the My Decks flow in [frontend_handoff.md](frontend_handoff.md#my-decks--v1medecks) — once the deck exists you study it with `mode: "deck"`.
- **`translationLang`:** collect this once (usually the user's native language from onboarding) and pass it on **every** session — it controls hint/option languages for translation-based question types, and the server signs it into each question, so it must be echoed back unchanged on `/answer`.

There's **no separate "enroll" step in this flow.** Starting a session auto-enrolls any brand-new words it picks.

---

## Step 2 — Start the session

One call kicks off the whole study run:

**`POST /v1/me/learn/session`**

```jsonc
{ "mode": "daily", "limit": 15, "translationLang": "vi" }
// topic: { "mode": "topic", "topicSlug": "travel", ... }
// deck:  { "mode": "deck",  "deckId": "…uuid…", ... }
```

The response carries `enrolledNewlyCount` (new words just added to the study set), and **`items[]`** — the flat, ordered list of signed questions to run. Full field tables: [learn_vocabulary_flow.md → Start a session](learn_vocabulary_flow.md#1-start-a-session--post-v1melearnsession).

### Branch A — `items` is empty → empty-state screen

When `items.length === 0`, render an empty state keyed off `emptyReason`:

| `emptyReason` | Screen to show |
|---|---|
| `no_due_cards` | "All caught up — come back at **`nextDueAt`**." (only this reason sets `nextDueAt`) |
| `no_more_at_level` | "No new words left at your level" — suggest raising level or trying a topic. |
| `no_enrollment` | "Nothing to study yet" — prompt to pick a deck/topic or add words. |
| `deck_exhausted` | "You've finished this deck." — suggest another deck. |

### Branch B — `items.length > 0` → go to the question runner (Step 3)

Keep the whole `items[]` array in client state as your run queue, **in the order returned**. Each item is a signed question; steps of the same word share a `groupId` and carry `stepIndex` / `stepCount`.

---

## Step 3 — Render & answer the question ladder

This is the core study screen. Walk `items[]` in order. For each item:

1. **Render `item.prompt`** — switch on `item.prompt.type`. There are twelve types (flashcard, cloze_mcq, cloze_typing, meaning_in_context, sense_disambiguation, listening_cloze, word_from_translation, translation_from_word, listening_choice, dictation, image_choice, pronunciation). The per-type prompt fields, what to render, and what to send as `userAnswer` are in the [question-types table](learn_vocabulary_flow.md#question-types--render-prompt-by-prompttype). The frontend never chooses the type — it renders whatever arrives.
2. **Collect the answer.** For MCQ-style types it's the chosen option text; for typing/dictation it's the typed string; for `flashcard` it's a self-rating (`forgot` | `hard` | `good` | `easy`); for `pronunciation` run client speech-to-text and submit the transcript.
3. **Submit** → `POST /v1/me/learn/answer`, echoing the item's signed envelope (`vocabularyId`, `type`, `exampleId`, `stepIndex`, `stepCount`, `nonce`, `issuedAtMs`, `signature`, plus the same `translationLang`) along with `userAnswer` and `latencyMs`.
4. **Show feedback** from the response: `correct` (bool) and `correctAnswer` (canonical answer — always reveal it, especially when wrong).
5. **Advance** to the next item.

### UI you can build from the envelope fields

- **Lesson progress within a word:** `stepIndex` / `stepCount` (e.g. "Step 2 of 5") and `groupId` (group consecutive steps of the same `lemma` under one header/progress bar).
- **Overall session progress:** index into `items[]` (plus any requeued items, see below).
- **Per-step vs. per-word completion:** only the **final step** of a word (`stepIndex === stepCount - 1`) returns a populated `progress` object and reschedules the card. On earlier steps `progress` is `null` — that's expected; just show feedback and move on. Treat "completed the last step" as "this word was reviewed."

### ⚠️ Signature expiry

The signed envelope expires **~30 minutes** after `issuedAtMs`. If a user sits on a question too long, `/answer` returns `401` (`signature expired` / `invalid signature`). Don't let a session idle indefinitely — on that error, fetch a fresh session rather than retrying the stale item.

---

## Step 4 — What happens after finishing

There is **no "end session" endpoint** — a session is just the queue of items you were handed. Two things shape the end of the run:

### 4a. Intra-session requeue (during the run)

On a word's **final step**, the answer response may include a non-null `requeue`:

```jsonc
"requeue": { "dueAtMs": 1717400600000, "items": [ /* the word's next-stage ladder */ ] }
```

This happens when the SRS schedules the card to come due again soon (within ~15 min — it's still being learned this sitting). **Enqueue `requeue.items` and re-surface them at `dueAtMs`**, within the same session. Because the word advanced a stage, these are typically *harder* question types than the ones just shown. When `requeue` is `null`, the card is scheduled far enough out that it'll come back in a future `POST /session` — drop it from this run.

So the real "session finished" condition is: **the original `items[]` are done AND no requeued items remain due.**

### 4b. Session-complete screen

Once the queue (including requeues) is drained:
- Show a summary you computed client-side from the answers (e.g. words studied = distinct `groupId`s completed, accuracy = correct/total, time spent). The API doesn't return a session rollup — track it on the client.
- **Refresh `GET /v1/me/stats`** to update streak / `dueNow` / `counts` / `nextDueAt` on the home screen.
- Offer **"Study more"** → start another `POST /session`. If it returns `emptyReason: "no_due_cards"`, switch to the "come back at `nextDueAt`" empty state.

---

## State machine summary

```
PICK_SOURCE ──(POST /session)──▶ LOADING
LOADING ──(items === [])──▶ EMPTY(emptyReason)
LOADING ──(items.length > 0)──▶ QUESTION(i)
QUESTION(i) ──(render prompt, user answers, POST /answer)──▶ FEEDBACK(i)
FEEDBACK(i) ──(requeue != null)──▶ enqueue requeue.items at dueAtMs
FEEDBACK(i) ──(more items in queue)──▶ QUESTION(i+1)
FEEDBACK(i) ──(queue drained)──▶ COMPLETE
COMPLETE ──(GET /me/stats; "Study more")──▶ PICK_SOURCE
EMPTY / QUESTION ──(401 signature expired/invalid JWT)──▶ refresh token / fresh session
```

---

## Gotchas checklist

- [ ] Pass `translationLang` on **session creation** and echo the **same value** on every `/answer` (it's signed). Mismatches → `401` on translation-based questions.
- [ ] Echo **all** signed envelope fields back verbatim on `/answer`; don't recompute `stepIndex`/`stepCount` client-side.
- [ ] Expect `progress: null` on every step except the word's last — it's not an error.
- [ ] Handle `requeue` within the session; don't call `/session` again just to re-show a just-learned word.
- [ ] Render any `type` that arrives — the server decides the ladder; data gaps (no audio/image/translation) just mean fewer types, never a client decision.
- [ ] `daily`/`review` need no list call; only `topic` (→ `GET /v1/topics`) and `deck` (→ deck list APIs) need a selection screen.
- [ ] Gate the **review** CTA on `dueNow > 0` (from `/me/stats`) so users don't start an empty review.

---

## Endpoints touched in this flow

| Endpoint | Role in the flow |
|---|---|
| `GET /v1/me/stats` | Home dashboard + post-session refresh |
| `GET /v1/topics` | Populate the **topic** source picker |
| `GET /v1/me/decks/suggested`, `GET /v1/decks`, `GET /v1/me/decks` | Populate the **deck** source picker |
| `POST /v1/me/learn/session` | Start the run, get signed questions |
| `POST /v1/me/learn/answer` | Submit each answer, get feedback + schedule + requeue |

For exhaustive request/response shapes and error tables, follow the links above to **[learn_vocabulary_flow.md](learn_vocabulary_flow.md)**.
