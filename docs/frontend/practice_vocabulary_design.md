# Design — Practice vocabulary (write a sentence & record audio)

Screen & layout guide for the **Practice** feature, where a learner produces language with a target word in two modes:

- **Write a sentence** → an LLM judge scores grammar / word-usage / naturalness / relevance and returns a rubric + CEFR. **Async** (submit → poll).
- **Record audio (speak the word)** → a phoneme scorer returns a per-sound `0–100` score and a coarse label. **Synchronous**.

This doc is the **layout / UX / state** spec. It does **not** restate the wire contracts — those are the source of truth and live here:

- Write a sentence: **[practice_submit_sentence.md](practice_submit_sentence.md)** — `POST /v1/me/practice/attempts`, `GET /v1/me/practice/attempts/:id`
- Record audio: **[pronunciation_score.md](pronunciation_score.md)** — `POST /v1/pronunciation/score`, `GET /v1/pronunciation/attempts`
- Shared conventions (base URL, auth header, pagination, errors): **[frontend_handoff.md](frontend_handoff.md)**

> The two modes are **separate backends with different timing models** — don't build one polling/loading abstraction for both. Writing is queued and polled; speaking returns inline. Keep that split in the component design.

---

## 1. Where it lives & how the user arrives

Practice is always **anchored to one target word** (a `vocabularyId`). The user reaches the practice screen from:

- a word's **detail page** ("Practice this word"),
- the **learn session** (the `pronunciation` question type already records audio — see [learn_pronunciation_question.md](learn_pronunciation_question.md)),
- a dedicated **Practice hub** that picks a due/enrolled word.

So the screen below assumes you already have `{ vocabularyId, lemma, ipa?, audioUrl? }` in hand. (Speaking mode can also score a **free-text `word`** with no `vocabularyId` — use that only outside the catalog flow.)

```
┌───────────────────────────────────────────────┐
│  ← Practice                                    │
│                                                │
│   ephemeral   /əˈfem(ə)rəl/        🔊 (audioUrl)│   ← target word header
│   adjective · "lasting a very short time"       │
│                                                │
│   ┌────────────┐  ┌────────────┐                │
│   │ ✍  Write   │  │ 🎙  Speak  │   ← mode tabs   │
│   └────────────┘  └────────────┘                │
│   ───────────────────────────────────────       │
│                                                │
│              ( active mode panel )              │
│                                                │
└───────────────────────────────────────────────┘
```

The **mode tabs** map 1:1 to the two endpoints. The word header (lemma, IPA, play reference audio) is shared and stays mounted across tab switches.

---

## 2. Mode A — Write a sentence (async)

### 2.1 Layout

```
┌─ ✍ Write a sentence using "ephemeral" ───────────┐
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │ Her fame proved ephemeral, fading within a  │ │  ← textarea
│  │ single week.|                               │ │     (1–280 chars)
│  └─────────────────────────────────────────────┘ │
│                                       52 / 280     │  ← live counter
│                                                   │
│  [ Submit for scoring ]            🔥 23/30 today  │  ← daily quota hint
└───────────────────────────────────────────────────┘
```

- **Textarea** — single sentence. Hard-limit **280 chars**; show a live `count / 280`. Disable Submit when empty or over the limit (`text` is `1–280`; over-length is a `400`).
- **Modality** is sent automatically: `writing` when typed. If you wire a "dictate" mic button that fills the textarea via the Web Speech API, send `modality: "speaking"` instead — but it is **still text-scored**; pronunciation is *not* judged here (that's Mode B). See the caveat in the wire doc.
- **Daily quota** — there's a per-user cap (default **30/day**). Optionally show a counter; a `429` means out for the UTC day → render a "come back tomorrow" state and disable Submit.

### 2.2 State machine

```
idle ──Submit──▶ submitting ──202──▶ scoring(polling) ──┬─ scored ──▶ result card
                     │                      │            └─ failed ──▶ error + Retry
                     └─ 400/401/429/503 ──▶ inline error (stay in idle)
```

| State | UI |
|---|---|
| **idle** | Editable textarea + enabled Submit. |
| **submitting** | Disable inputs, spinner on the button. On `202` keep the returned `attemptId`. |
| **scoring** | Replace the form with a "Scoring your sentence…" placeholder (skeleton rubric). **Poll** `GET /attempts/:id` with backoff **1.5 s → 3 s → 5 s** (cap ~5 s) until `status !== 'pending'`. After ~60 s give up auto-polling and offer a **"Check again"** button (the attempt is still queued and will eventually resolve). |
| **scored** | Render the result card (§2.3). |
| **failed** | Show `error` text + **Retry** (a fresh `POST`). |

> Scoring runs on a rate-limited free-tier model shared across users — seconds normally, longer when saturated. **Never block the UI synchronously**; the loading state must be cancellable/navigable.

### 2.3 Result card (`status: scored`)

```
┌─ Result ──────────────────────────────────  88 / 100 ─┐
│  Demonstrates:  B2          ✓ uses "ephemeral"         │
│                                                        │
│  Grammar      ●●●●●  5/5                                │
│  Word usage   ●●●●●  5/5                                │
│  Naturalness  ●●●●○  4/5                                │
│  Relevance    ●●●●●  5/5                                │
│                                                        │
│  “Natural, correct use of ‘ephemeral’. Strong          │
│   sentence.”                                            │
│                                                        │
│  Suggested:  Her fame proved ephemeral, fading within… │  ← only if correctedSentence present
│                                                        │
│  [ Try another sentence ]    [ Switch to Speak 🎙 ]    │
└────────────────────────────────────────────────────────┘
```

Field → UI mapping (full shapes in the wire doc):

- **`score`** (0–100) — the big number / progress ring. Color by band (§5).
- **`cefr`** — a small chip labeled *"Demonstrates"*. ⚠️ This is the level of **this one sentence**, **not** the user's proficiency — never present it as the learner's certified level, and don't derive it from `score`.
- **`rubric.usesTargetWord` / `correctUsage`** — green check / amber warning chips.
- **`rubric.criteria.*`** — four `0–5` bars (grammar, wordUsage, naturalness, relevance).
- **`feedback`** — the learner-facing line (quote it).
- **`rubric.correctedSentence`** — show a "Suggested" block **only when present** (omitted when the sentence was already good).

---

## 3. Mode B — Record audio (synchronous)

### 3.1 Layout

```
┌─ 🎙 Say the word: "ephemeral" ───────────────────┐
│                                                   │
│            ╭───────────────╮                      │
│            │      ●        │   ← record button     │
│            │   tap to rec  │     (hold or toggle)  │
│            ╰───────────────╯                      │
│            ▁▂▅▇▅▂▁  00:00.8     ← live level meter  │
│                                                   │
│   🔊 Hear it first   |   ⟳ Re-record   |  ▶ Play   │
│                                                   │
│   [ Score my pronunciation ]                      │
└───────────────────────────────────────────────────┘
```

- **Record button** — request mic permission on first use; show a clear permission-denied fallback.
- **Reference audio** — let the user hear the target (`audioUrl`) before recording.
- **Re-record / playback** of the captured clip before sending.

> ⚠️ **Format gotcha — this drives your recording code.** The scorer decodes **WAV / FLAC / OGG only**, ≤ **5 MB**. Browser `MediaRecorder` defaults to `webm/opus`, which is **rejected with `400`**. Capture PCM via the Web Audio API and wrap it as a **WAV** Blob (or transcode), and send the matching MIME (`audio/wav`). Upload as `multipart/form-data` with the `audio` field — **do not set `Content-Type` manually** (the browser sets the multipart boundary).

### 3.2 State machine

```
idle ─rec─▶ recording ─stop─▶ preview ─Score─▶ uploading ──201──▶ result
                                  │                 └─ 400/401/404/503 ─▶ inline error
                                  └─ Re-record ─▶ recording
```

Unlike Mode A this is **synchronous**: the `POST` returns the full result (`201`) in a few hundred ms once the service is warm. Show a brief spinner, not a polling state. The backend times out upstream at ~8 s and returns **`503`** → show a **Retry**.

### 3.3 Result — phoneme breakdown (`201`)

```
┌─ Pronunciation  ────────────────────────────  72 / 100 ─┐
│                                                          │
│     θ        ɪ        n          ← per-phoneme chips      │
│   ┌────┐   ┌────┐   ┌────┐                                │
│   │ 64 │   │ 88 │   │ 65 │                                │
│   │amber  │green   │amber │      ← color = label          │
│   └────┘   └────┘   └────┘                                │
│   practice  good    practice                             │
│                                                          │
│   ▶ Play   ·  tap a phoneme to hear that span            │
│                                                          │
│   ⚠ A bit quiet (SNR 12 dB) — try a louder, closer take. │  ← audioQuality warning (conditional)
│                                                          │
│   [ Re-record ]        [ Switch to Write ✍ ]             │
└──────────────────────────────────────────────────────────┘
```

Field → UI mapping (full shapes in the wire doc):

- **`overallScore`** (0–100) — headline number / ring, colored by band (§5).
- **`phonemes[]`** — one chip per phone, **left-to-right in array order**. Each has `phone`, `score`, and **`label`** (`good` ≥ 75 / `practice` 45–74 / `wrong` < 45) → color the chip by label (§5).
- **`start_sec` / `end_sec`** — the clip time-span of each phone. Use them to **highlight during playback** and to let the user tap a phoneme to replay just that span.
- **`transcriptPhonemes`** — the canonical IPA sequence the word was scored against (show as the "target" reading).
- **`audioQuality`** — show a non-blocking warning when `clipping: true` or `snr_db` is low; a `too_short` clip comes back as a **`400` "audio too short"** (handle as an error, not a warning).
- **`modelVersion`** — debug/footnote only; not user-facing.

---

## 4. Shared — history

Both modes have a history list (newest first, paginated `page`/`limit`):

- **Speaking**: `GET /v1/pronunciation/attempts` (filter by `vocabularyId` or `word`) → rows with `overallScore` + `phonemeScores[]`.
- **Writing**: poll-by-id only today; if you keep a client-side list, store each `attemptId` and its last polled projection.

A per-word "your attempts" strip (sparkline of `overallScore` over time) is a natural reuse of the speaking history endpoint.

---

## 5. Visual encoding (shared scale)

Keep one color scale across both modes so a "72" reads the same everywhere.

| Band | `score` / `overallScore` | Phoneme `label` | Suggested color |
|---|---|---|---|
| Good | **75–100** | `good` | green |
| Practice | **45–74** | `practice` | amber |
| Needs work | **0–44** | `wrong` | red |

- Rubric `criteria.*` are on a **0–5** scale (dots/bars), independent of the 0–100 band scale — don't recolor them with the band thresholds.
- `cefr` is a **categorical** chip (A1–C2), not a score — neutral styling, never the band colors.

---

## 6. States, empty & error matrix

| Situation | Mode | UI |
|---|---|---|
| Mic permission denied | Speak | Replace recorder with a "Enable microphone to practice speaking" prompt + retry. |
| `webm/opus` would be sent | Speak | Prevented in code — always encode WAV/FLAC/OGG before upload. |
| `400` audio too short / bad word | Speak | Inline: "Recording too short — hold a bit longer." Offer Re-record. |
| `503` scorer timeout/unreachable | Speak | "Scoring is busy, try again." Retry button. |
| `429` daily limit | Write | Disable Submit, show "You've used all N practice sentences today." |
| `failed` status | Write | Show `error`, offer a fresh submit. |
| Auto-poll exceeded ~60 s | Write | Stop auto-poll, show "Still scoring…" + manual **Check again**. |
| `401` on any call | Both | Refresh the access token, then retry the call. |
| No `vocabularyId` (free-text) | Speak only | Allowed via `word`; Write mode requires a real `vocabularyId`. |

---

## 7. Build checklist

- [ ] Word header shares `lemma` / `ipa` / `audioUrl`; mode tabs swap only the panel.
- [ ] Write: 280-char counter, async submit→poll with backoff + 60 s cap, rubric card, `score`/`cefr` kept distinct.
- [ ] Speak: WAV (not webm) capture, ≤5 MB, `multipart` with no manual `Content-Type`, synchronous result, phoneme chips colored by `label`, tap-to-replay span via `start_sec`/`end_sec`.
- [ ] One shared 0–100 → green/amber/red band scale; `cefr` styled categorically.
- [ ] Every error row in §6 has a concrete affordance.
