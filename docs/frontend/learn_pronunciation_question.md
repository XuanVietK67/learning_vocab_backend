# Learn — `pronunciation` question type (acoustic scoring)

How the **`pronunciation`** question inside a learn session is changing: from "client speech‑to‑text → submit a transcript" to "**record audio → score it acoustically → submit the scored attempt**". This doc is for the frontend that renders the question card and designs the record / feedback screen.

> **Status — read this first.**
> - `POST /v1/pronunciation/score` and `GET /v1/pronunciation/attempts` are **live** (see [pronunciation_score.md](pronunciation_score.md)).
> - The learn‑flow grading change (server reads the attempt's score when you submit an `attemptId` to `POST /v1/me/learn/answer`) is **planned, not shipped yet** — tracked in [../plans/pronunciation_question_type_plan.md](../plans/pronunciation_question_type_plan.md). Until it ships, submitting an `attemptId` to `/answer` grades it as plain text against the lemma (i.e. "wrong"). **Build the record/score UI now; gate the "submit attemptId" wiring behind the backend ship, and keep the STT fallback below as the live path.**

Related: the overall session journey is in [learn_session_ui_flow.md](learn_session_ui_flow.md); the exact `/session` and `/answer` field tables are in [learn_vocabulary_flow.md](learn_vocabulary_flow.md). Shared conventions (base URL, auth header, errors) are in [frontend_handoff.md](frontend_handoff.md).

---

## 1. What changes

| | **Before (current live behaviour)** | **After (target)** |
|---|---|---|
| What the user does | Speaks; the **client** runs speech‑to‑text | Speaks; the client **records audio** |
| What the client submits | `userAnswer` = the STT **transcript** (a string) | `userAnswer` = the **`attemptId`** of a scored recording |
| Where the grade comes from | Lenient Levenshtein of transcript vs. `lemma` — "did an STT engine spell the word" | The **acoustic GOPT phoneme scorer** — "how well did you actually pronounce it", per‑phoneme `0–100` → overall |
| Audio reaches the backend? | No | Yes (to `/pronunciation/score`, which persists the attempt) |
| Feedback you can show | correct / not | **Per‑phoneme** scores + labels (`good` / `practice` / `wrong`), an overall score, and audio‑quality warnings |

The **question prompt** the server sends for this type is unchanged:

```jsonc
// item.prompt for a pronunciation question
{
  "type": "pronunciation",
  "lemma": "thin",
  "ipa": "θɪn",          // may be null
  "audioUrl": "https://…/thin.mp3" // reference pronunciation to play; may be null
}
```

Everything else about the item envelope (the signed `vocabularyId`, `exampleId`, `stepIndex`, `stepCount`, `signature`, `nonce`, `issuedAtMs`, `translationLang`) is the same as every other question — echo it back on `/answer` exactly as you do today.

---

## 2. The new two‑step flow

```
┌──────────────────────────────────────────────────────────────────────┐
│ Pronunciation card (item.prompt.type === "pronunciation")            │
└───────────────┬──────────────────────────────────────────────────────┘
                │ 1. User taps Record, says the word, taps Stop
                │    → capture WAV/FLAC/OGG (NOT webm/opus — see §5)
                ▼
   2. POST /v1/pronunciation/score        (multipart/form-data)
      audio=<blob>  +  vocabularyId=<item.vocabularyId>
                │
                ▼
      { attemptId, overallScore, phonemes[], audioQuality, … }
                │
                │ 3. Show the score UI (per-phoneme highlight, overall, retry)
                │    Let the user RETRY (re-record) as many times as you allow.
                │    Each retry = a new /score call = a new attemptId.
                ▼
   4. POST /v1/me/learn/answer            (signed JSON, same as every type)
      userAnswer = attemptId   (the chosen attempt)
      + echo the item's signed fields (vocabularyId, type, exampleId,
        stepIndex, stepCount, signature, nonce, issuedAtMs, translationLang)
                │
                ▼
      { correct, correctAnswer, quality, progress, requeue }
                │
                ▼
        Advance to next item (handle `requeue` like any other type)
```

**Why submit the `attemptId` and not the score number:** the HMAC signature on the item signs the *question*, not the audio. The server re‑reads `overallScore` from the persisted attempt, so a client can't just submit `100`. Submit the id of a scoring run the server already did.

---

## 3. Step 2 — score the recording

Full contract: **[pronunciation_score.md](pronunciation_score.md)**. The essentials for this card:

- **`POST /v1/pronunciation/score`**, `Authorization: Bearer <accessToken>`, `multipart/form-data`.
- Send `audio` (the recorded blob, **≤ 5 MB**) **and** `vocabularyId` = the item's `vocabularyId`. Send **exactly one** of `vocabularyId` / `word`; for a learn item always use `vocabularyId`.
- **Do not set `Content-Type` manually** — let the browser/runtime set the multipart boundary.

Response `201` (trimmed):

```jsonc
{
  "attemptId": "a1b2c3d4-…",          // ← this is what you submit to /answer
  "word": "thin",
  "overallScore": 72,                  // integer 0–100
  "transcriptPhonemes": ["θ","ɪ","n"], // canonical IPA the word was scored against
  "phonemes": [
    { "phone": "θ", "score": 64, "label": "practice", "start_sec": 0.12, "end_sec": 0.20 },
    { "phone": "ɪ", "score": 88, "label": "good",     "start_sec": 0.20, "end_sec": 0.30 },
    { "phone": "n", "score": 65, "label": "practice", "start_sec": 0.30, "end_sec": 0.41 }
  ],
  "audioQuality": { "duration_sec": 0.41, "too_short": false, "clipping": false, "snr_db": 24.1 },
  "modelVersion": "gopt-wav2vec2-espeak-v1",
  "createdAt": "2026-06-09T10:25:00.000Z"
}
```

- `label`: `good` (score ≥ 75), `practice` (45–74), `wrong` (< 45) — use it directly to colour each phoneme.
- `phonemes[]` is left‑to‑right; `start_sec`/`end_sec` let you highlight phonemes in sync with playback.

Score endpoint errors to handle on this card:

| Status | Meaning | UI |
|---|---|---|
| `400` | bad/oversized/wrong‑type audio, **too short**, or the word couldn't be phonemized | "Couldn't read that recording — try again." Use `audioQuality.too_short` to say "Hold a bit longer." |
| `401` | token expired | refresh + retry |
| `404` | `vocabularyId` not found | shouldn't happen for a valid item — surface a generic error |
| `503` | scoring service down/timed out | **fall back to STT** (see §6) or offer Retry |

---

## 4. Step 4 — submit the attempt, and the score → grade map

Submit the chosen `attemptId` as `userAnswer` on the normal signed endpoint — **same request as every other question type**, see [learn_vocabulary_flow.md](learn_vocabulary_flow.md) §2:

```jsonc
POST /v1/me/learn/answer
{
  "vocabularyId": "…",            // echoed from the item
  "type": "pronunciation",
  "exampleId": "…",
  "stepIndex": 4, "stepCount": 5,
  "userAnswer": "a1b2c3d4-…",     // ← the attemptId from /score
  "latencyMs": 4200,
  "nonce": "…", "issuedAtMs": 1717400000000, "signature": "…",
  "translationLang": "vi"         // only if the item carried one
}
```

The server (once the planned change ships) resolves the attempt, checks it belongs to this user + vocabulary and is fresh, reads its `overallScore`, and maps it to an SM‑2 `quality`:

| `overallScore` | `quality` | `correct` |
|---|---|---|
| ≥ 85 | 5 | ✅ |
| 75–84 | 4 | ✅ |
| 60–74 | 3 | ✅ |
| 45–59 | 3 | ✅ |
| < 45 | 2 | ❌ |

> These thresholds are **tunable** and may shift after real attempts are reviewed — don't hard‑code them in the client; read `correct` / `quality` from the `/answer` response. (They're listed here only so the score you show and the pass/fail the user gets feel consistent.)

The `/answer` response is identical to other types — `{ correct, correctAnswer, quality, progress, requeue }` — so the rest of your runner (feedback, `requeue` re‑enqueue, advancing the ladder) needs **no special‑casing** for pronunciation.

---

## 5. Audio capture — the one gotcha

The scoring service decodes **WAV / FLAC / OGG only**. Browser `MediaRecorder` defaults to **`webm/opus`, which is rejected** (`400`).

- **Web:** capture PCM via the Web Audio API (`AudioContext` + `ScriptProcessor`/`AudioWorklet`) and wrap it as a **WAV** Blob, or transcode before upload. Send `audio/wav`.
- **Native mobile:** record WAV/AAC‑in‑a‑supported‑container directly — much easier; record at 16 kHz mono if you can.
- Send the **matching MIME type** (`audio/wav`, `audio/flac`, `audio/ogg`).
- Keep clips short and the word clear; a too‑short clip is rejected with `400`. Warn the user up front to say just the single word.

---

## 6. Fallback (keep the loop alive)

Acoustic scoring adds a runtime dependency. If `/pronunciation/score` returns `503` (or you can't produce valid audio on this device), fall back to the **current STT path**: run client speech‑to‑text and submit the **transcript string** as `userAnswer` (not a UUID). The server's grader branches on the shape of `userAnswer`:

- looks like a **UUID** → acoustic attempt lookup (the new path),
- otherwise → the existing lenient transcript‑vs‑lemma compare.

So a degraded session still grades and nothing regresses. Surface a small "scored offline" / "couldn't reach the pronunciation coach" hint when you fall back, and keep the rest of the card identical.

---

## 7. Suggested layout

Two states on one card: **record** → **result**. Keep the target word, its IPA, and the reference‑audio play button visible throughout.

**A. Record state**

```
┌─────────────────────────────────────────────┐
│  Say the word                               │
│                                             │
│            t h i n      🔊  (audioUrl)       │   ← lemma + play reference
│            /θɪn/                             │   ← ipa (hide row if null)
│                                             │
│              ●  ●  ●  ●  ●                   │   ← live mic level / waveform
│                                             │
│        ╭───────────────────────╮            │
│        │   🎙  Hold to record   │            │   ← press-and-hold or tap-to-toggle
│        ╰───────────────────────╯            │
│        Skip            Use keyboard ↗        │   ← Skip = quality-low; keyboard = STT fallback
└─────────────────────────────────────────────┘
```

**B. Scoring → result state** (after `/score` returns)

```
┌─────────────────────────────────────────────┐
│   Overall  72        ▶ play my recording     │   ← overallScore; replay the user's clip
│   ▓▓▓▓▓▓▓░░░  "Good — polish a couple sounds" │   ← gauge + a phrase keyed off the label band
│                                             │
│   θ   ɪ   n                                 │   ← one chip per phoneme, coloured by `label`:
│  ░64  ▓88  ░65                              │     good=green, practice=amber, wrong=red
│                                             │     tap a chip → highlight its start/end in playback
│   ⚠ A bit quiet — move closer next time      │   ← only if audioQuality.clipping / low snr_db
│                                             │
│      ↻ Try again            Continue →        │   ← retry = new /score; Continue = submit attemptId
└─────────────────────────────────────────────┘
```

Design notes:

- **Per‑phoneme chips** are the payoff of this change — colour each by its `label`, show the number on tap/hover, and (optionally) flash the matching span using `start_sec`/`end_sec` while replaying the user's recording.
- **Retry is first‑class.** Each retry is a fresh `/score` → fresh `attemptId`. Submit the attempt the user chose to keep (usually the last/best). Decide and document your retry cap; the user only commits a grade when they hit **Continue**.
- **Map the overall band to copy**, not just a number: ≥75 "Great", 45–74 "Getting there", <45 "Let's try again" — and let the colour match the `good/practice/wrong` palette so it agrees with the chips.
- **Latency:** scoring is a few hundred ms once warm but can spike; show a brief "Scoring…" spinner between Stop and the result. Backend times the upstream out at ~8 s → `503`; show Retry / fallback then.
- **Don't block the session.** Always offer **Skip** (advance, low quality) and the **keyboard / STT fallback** so a bad mic or a `503` never traps the learner.

---

## 8. Quick checklist

- [ ] Record audio as **WAV/FLAC/OGG**, ≤ 5 MB (never raw `webm/opus`).
- [ ] `POST /v1/pronunciation/score` with `audio` + `vocabularyId`; **don't** set `Content-Type`.
- [ ] Render `overallScore` + per‑phoneme `label` colours; surface `audioQuality` warnings.
- [ ] Allow retry (new attempt each time); submit the kept **`attemptId`** as `userAnswer` on `/answer`.
- [ ] Echo all signed item fields on `/answer`; read `correct`/`quality` from the response (don't compute them).
- [ ] Handle `503`/bad audio by **falling back to STT transcript** as `userAnswer`.
- [ ] Keep **Skip** available so the card is never a dead end.
