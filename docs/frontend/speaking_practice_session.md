# Speaking Room — Live practice session (frontend guide)

The learner's **live, turn-based conversation** with an AI partner: start a session
on a scenario, exchange turns (the AI replies in character and quietly corrects the
learner on screen), then end it for a feedback report. Phase 2a is **text-only** —
the same endpoints will later accept audio (STT) and return spoken replies (TTS).

- **Endpoints:** `POST /v1/speaking/sessions` · `POST /v1/speaking/sessions/:id/turn` · `POST /v1/speaking/sessions/:id/end` · `GET /v1/speaking/sessions/:id/report`
- **Auth:** `Authorization: Bearer <accessToken>` (any logged-in user)
- **Content type:** `application/json`
- Catalogue: [speaking_browse_scenarios.md](speaking_browse_scenarios.md) · canonical contract: [api-endpoints.md](../backend/api-endpoints.md) · design: [speaking_room_phase2_user_practice.md](../plans/speaking_room_phase2_user_practice.md)

The whole flow: **start → (turn ⇄ reply)\* → end → report.**

---

## 1. Start — `POST /v1/speaking/sessions`

```jsonc
{
  "scenarioId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",  // required, v4 UUID
  "vocabularyIds": [                                       // optional
    "11111111-1111-4111-8111-111111111111"
  ]
}
```

| Field | Required | Type | Rules |
|---|---|---|---|
| `scenarioId` | ✅ | UUID v4 | must be a **published** scenario |
| `vocabularyIds` | — | UUID v4[] | ≤ 50; words to weave in as soft goals. Omit/`[]` for none |

The CEFR level is read from the learner's profile server-side (falling back to the
scenario's level) — you do **not** send it.

### Response (201)

```jsonc
{
  "id": "2b1c…",                       // session id — use in every later call
  "scenarioId": "7c9e6679-…",
  "status": "active",
  "cefrLevel": "B1",                   // level the AI will pitch to, or null
  "selectedWords": ["recommend", "afford"],     // resolved lemmas (snapshot)
  "inaccessibleVocabularyIds": [],     // requested IDs that were dropped
  "openingLine": "Hi there! What can I get for you today?",
  "createdAt": "2026-06-25T10:00:00.000Z"
}
```

- **Show/speak `openingLine` first** — it is the AI's turn 0, scripted from the
  scenario (no model call).
- `vocabularyIds` that aren't usable (another user's private word, an unapproved
  draft, or a bad id) are silently dropped into `inaccessibleVocabularyIds` —
  surface a subtle "N words couldn't be added" if non-empty.
- `selectedWords` is the snapshot actually in play; show these as the session's
  target words.

---

## 2. Take a turn — `POST /v1/speaking/sessions/:id/turn`

Send what the learner said; get the AI's reply plus on-screen corrections.

```jsonc
{ "text": "I want a coffee and something to eat" }   // required, 1–1000 chars
```

### Response (200)

```jsonc
{
  "turnIndex": 2,                       // this AI turn's index in the transcript
  "reply": "Great choice! Would you like a muffin or a croissant?",
  "corrections": [
    {
      "userSaid": "I want a coffee",
      "better": "I'd like a coffee, please",
      "why": "More polite for ordering."
    }
  ],
  "usedTargetWords": ["recommend"]      // target words the AI used this turn
}
```

- **`reply` is the spoken channel** — show it as the AI's message (and speak it via
  the device's `SpeechSynthesis` for now; server-side TTS is a later milestone).
- **`corrections` is the teaching channel** — render as quiet on-screen cards;
  never interrupt or "speak" them. Often empty `[]` when there's nothing to fix.
- `usedTargetWords` lets you tick off practised words live.

Repeat step 2 for each turn. The AI keeps replies short and ends with a question.

---

## 3. End — `POST /v1/speaking/sessions/:id/end`

No body. Marks the session ended and generates the feedback report (one slower
model call over the full transcript). **Idempotent** — calling it again returns the
stored report, retrying generation if a previous attempt failed.

### Response (200)

```jsonc
{
  "sessionId": "2b1c…",
  "reportStatus": "ready",             // "ready" | "failed" | "pending"
  "reportModel": "llama-3.3-70b-versatile",
  "report": {
    "summary": "Great session! You ordered clearly and asked good questions.",
    "topMistakes": [
      { "userSaid": "I want", "better": "I'd like", "why": "More polite." }
    ],
    "targetWordsUsed": ["recommend"],
    "targetWordsMissed": ["afford"],
    "estimatedLevel": "B1",            // demonstrated level, or null
    "whatToPracticeNext": ["Polite requests", "Asking for recommendations"]
  }
}
```

When `reportStatus` is `failed`, `report` is `null` — show "couldn't build your
report" with a **Retry** that re-calls `end` or `GET …/report`.

---

## 4. Fetch the report later — `GET /v1/speaking/sessions/:id/report`

Same response shape as `end`. If the report isn't `ready` yet it is regenerated on
read. `400` if the session is still `active` (end it first).

---

## Errors

| Status | When | Frontend handling |
|---|---|---|
| `400` | turn on an ended session · per-session turn cap reached · report fetched while still active | block the action; for the cap, prompt the learner to **End** the session |
| `401` | missing/expired token | send to login / refresh |
| `404` | scenario not published (start) · session not the caller's | show "not found" |
| `429` | daily speaking-session cap reached | "You've hit today's practice limit — try again tomorrow." |
| `503` | Groq unconfigured, or the model failed/timed out | for a **turn**, keep the input and offer **Retry** (the turn was not saved); for **start**, the feature is unavailable |

## UX notes

- Keep the session `id` for the whole conversation; every turn/end/report call needs it.
- A failed **turn** (`503`) is **not** persisted — safe to let the learner resend the
  same text. A failed **report** is safe to retry without re-ending.
- v1 is strictly turn-based (push-to-talk friendly): disable the input while a turn
  is in flight, re-enable when the reply lands.
- There is no separate "history" endpoint yet — accumulate turns client-side from the
  `openingLine` + each turn's `reply` and the `text` you sent.
