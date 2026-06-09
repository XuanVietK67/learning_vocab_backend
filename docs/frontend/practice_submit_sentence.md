# Practice — sentence scoring

Word-anchored open-production practice: the user writes (or speaks, via client speech-to-text) a sentence using a target word, and an LLM judge scores it. Scoring is **asynchronous** — submit returns `202` and the client polls for the rubric.

- `POST /v1/me/practice/attempts` — submit a sentence. **JWT required.**
- `GET /v1/me/practice/attempts/:id` — poll for the result. **JWT required.**

Auth: `Authorization: Bearer <accessToken>` on both. Content type `application/json`.

---

## Why async

The judge is Gemma 3 on Google AI Studio's **free tier**, which is rate-limited and shares one key across all users. Submissions are queued and scored by a throttled background worker, so:

- `POST` never blocks on the model — it returns `202` with an `attemptId` immediately.
- The result lands later (usually seconds; longer if the free-tier quota is saturated). **Poll** `GET /attempts/:id` until `status` is `scored` or `failed`.
- A per-user **daily cap** (default 30/day) protects the shared quota — a `429` means the user is out of attempts for the UTC day.

---

## `POST /v1/me/practice/attempts`

Create a scoring attempt for one target word.

### Request body

```json
{
  "vocabularyId": "c2a1f0e1-1234-4abc-8def-0123456789ab",
  "text": "Her fame proved ephemeral, fading within a single week.",
  "modality": "writing"
}
```

| Field | Required | Type | Rules |
|---|---|---|---|
| `vocabularyId` | ✅ | string | UUID v4 of the target word. `404` if it doesn't exist. |
| `text` | ✅ | string | 1–280 chars. The sentence — typed, or a speech-to-text transcript. |
| `modality` | ✅ | enum | `writing` or `speaking`. Records how the text was produced; **scoring is identical** for both. Use `speaking` when `text` is a client STT transcript. |

> **Speaking = writing + a transcript.** Gemma scores text only. For a "speaking" attempt, run speech-to-text on the client (the same Web Speech API path the `pronunciation` question type uses) and submit the transcript here with `modality: "speaking"`. Pronunciation/fluency are **not** assessed — only grammar, word usage, naturalness, and relevance of the resulting sentence.

### Response `202 Accepted`

```json
{ "attemptId": "f0e1d2c3-5678-4abc-9def-0123456789ab", "status": "pending" }
```

Store `attemptId` and poll the GET endpoint.

### Errors

| Status | When | Frontend action |
|---|---|---|
| `400` | `text` empty/too long, bad `modality`, non-UUID `vocabularyId`, unknown body field | Fix the request; show the field error. |
| `401` | Missing/expired JWT | Refresh the access token. |
| `404` | `vocabulary not found` | The target word doesn't exist — re-pick. |
| `429` | `daily practice limit reached (N/day)` | Out of attempts for today; show a "come back tomorrow" state. |
| `503` | `scoring queue unavailable` | Transient infra issue — let the user retry shortly. |

---

## `GET /v1/me/practice/attempts/:id`

Poll for the result. Only returns attempts owned by the caller.

### Response `200`

While pending:

```json
{
  "id": "f0e1d2c3-5678-4abc-9def-0123456789ab",
  "vocabularyId": "c2a1f0e1-1234-4abc-8def-0123456789ab",
  "modality": "writing",
  "text": "Her fame proved ephemeral, fading within a single week.",
  "status": "pending",
  "score": null,
  "cefr": null,
  "rubric": null,
  "feedback": null,
  "error": null,
  "createdAt": "2026-06-04T08:00:00.000Z",
  "scoredAt": null
}
```

Once scored:

```json
{
  "id": "f0e1d2c3-5678-4abc-9def-0123456789ab",
  "vocabularyId": "c2a1f0e1-1234-4abc-8def-0123456789ab",
  "modality": "writing",
  "text": "Her fame proved ephemeral, fading within a single week.",
  "status": "scored",
  "score": 88,
  "cefr": "B2",
  "rubric": {
    "overall": 88,
    "usesTargetWord": true,
    "correctUsage": true,
    "criteria": { "grammar": 5, "wordUsage": 5, "naturalness": 4, "relevance": 5 },
    "cefr": "B2",
    "feedback": "Natural, correct use of \"ephemeral\". Strong sentence.",
    "correctedSentence": "Her fame proved ephemeral, fading within a single week."
  },
  "feedback": "Natural, correct use of \"ephemeral\". Strong sentence.",
  "error": null,
  "createdAt": "2026-06-04T08:00:00.000Z",
  "scoredAt": "2026-06-04T08:00:07.000Z"
}
```

### Result fields

| Field | Type | Meaning |
|---|---|---|
| `status` | enum | `pending` (queued) · `scored` (rubric ready) · `failed` (gave up — see `error`). |
| `score` | int \| null | Overall **0–100** quality of the attempt. `null` until scored. |
| `cefr` | enum \| null | CEFR level the **sentence demonstrates** (`A1`–`C2`). See the caveat below. `null` until scored. |
| `rubric` | object \| null | Full breakdown (below). `null` until scored. |
| `feedback` | string \| null | 1–2 sentences of learner-facing feedback (also inside `rubric`). |
| `error` | string \| null | Failure reason when `status='failed'`. |
| `scoredAt` | string \| null | ISO timestamp the score was written. |

**`rubric`** object:

| Field | Type | Meaning |
|---|---|---|
| `overall` | int (0–100) | Roll-up of `criteria`. |
| `usesTargetWord` | bool | Target word (or an inflection) present. |
| `correctUsage` | bool | Used with a sense that fits. |
| `criteria.grammar` | int (0–5) | Grammatical correctness. |
| `criteria.wordUsage` | int (0–5) | Correct, natural use of the target word. |
| `criteria.naturalness` | int (0–5) | How natural the phrasing reads. |
| `criteria.relevance` | int (0–5) | Whether the sentence meaningfully uses the word. |
| `cefr` | enum | Demonstrated level of the sentence. |
| `feedback` | string | Short learner feedback. |
| `correctedSentence` | string? | An improved version; omitted when already good. |

> ⚠️ **`score` and `cefr` measure different things.** `score` is *how good this attempt is*; `cefr` is *the linguistic level the sentence demonstrates*. A perfectly correct but simple sentence ("Time is ephemeral.") can be high `score` / low `cefr`. **`cefr` is the level of this one sentence, not the user's certified level** — do not display it as the learner's proficiency, and do not derive `score` from `cefr` or vice versa.

### Errors

| Status | When | Frontend action |
|---|---|---|
| `401` | Missing/expired JWT | Refresh the access token. |
| `404` | `attempt not found` (or not owned by the caller) | Stop polling; surface a generic error. |

---

## Suggested client flow

1. `POST /attempts` → keep `attemptId`, show a "scoring…" state.
2. Poll `GET /attempts/:id` with a small backoff (e.g. **1.5 s → 3 s → 5 s**, cap ~5 s) until `status !== 'pending'`. Give up after ~60 s and let the user re-poll manually (the attempt is still being worked on and will eventually flip to `scored`/`failed`).
3. `scored` → render `score`, `cefr`, the `criteria` bars, `feedback`, and `correctedSentence` (if present).
4. `failed` → show `error` and offer a retry (a fresh `POST`).
