# Plan — acoustic scoring for the `pronunciation` learn question type

**Status:** Draft · **Scope:** backend (NestJS) · **Depends on:** the pronunciation scoring proxy
([pronunciation_score.md](pronunciation_score.md)) and the running Python scoring service
([pronunciation_scoring_design.md](pronunciation_scoring_design.md)).

## 1. Goal

Upgrade the existing `PRONUNCIATION` learn question type so the grade comes from the **acoustic
GOPT phoneme scorer** (the `/v1/pronunciation/score` system) instead of a client speech-to-text
transcript compared loosely against the lemma.

## 2. Current behaviour

- `PRONUNCIATION` already exists in [src/learn/enums/question-type.enum.ts](../src/learn/enums/question-type.enum.ts).
- The question is built by `buildPronunciation` ([question-builder.service.ts:514](../src/learn/question-builder.service.ts#L514)) →
  prompt `{ type, lemma, ipa, audioUrl }`.
- Grading falls through to `gradeLemmaTyping` ([answer-grader.service.ts:99-103](../src/learn/answer-grader.service.ts#L99-L103)):
  the **client** runs STT, submits the transcript as `userAnswer`, and the server does a lenient
  Levenshtein compare against the lemma. **No audio reaches the backend.**
- The answer travels over `POST /v1/me/learn/answer` as signed JSON
  ([submit-answer.dto.ts](../src/learn/dto/submit-answer.dto.ts)): `signature`, `nonce`,
  `stepIndex/stepCount`, `latencyMs`, `userAnswer` (string ≤1000).

## 3. Target behaviour

The grade reflects how the learner actually *pronounced* the word (per-phoneme 0–100 → overall),
not whether an STT engine transcribed it. The acoustic score is computed and **persisted
server-side** (`pronunciation_attempts`), so the grade is trustworthy.

## 4. Approach — two-step, grade by `attemptId` (recommended)

Reuses both pieces already shipped: the `/v1/pronunciation/score` endpoint and the existing
`/answer` flow. Do **not** push audio through the signed JSON `/answer` endpoint.

```
1. Client records the word.
2. Client -> POST /v1/pronunciation/score   (multipart: audio + vocabularyId)
        -> { attemptId, overallScore, phonemes[], ... }   # persisted in pronunciation_attempts
3. Client -> POST /v1/me/learn/answer   with userAnswer = attemptId   # normal signed flow
4. Server resolves the attempt, reads the authoritative overallScore, maps it to an SM-2 quality.
```

**Why look the attempt up (not trust a submitted number):** the HMAC signs the *question*, not the
audio. If the client submitted the score directly it could send `100`. By submitting the
`attemptId` and having the server read `overall_score` from `pronunciation_attempts`, the grade is
based on the server's own scoring run.

### Alternative (not chosen)

A dedicated multipart `POST /v1/me/learn/answer/pronunciation` that scores inline. One round-trip,
but it duplicates all the signature / nonce / step verification for a multipart variant — more
surface for marginal benefit.

## 5. Backend changes

| File | Change |
|---|---|
| [src/learn/answer-grader.service.ts](../src/learn/answer-grader.service.ts) | Split `PRONUNCIATION` out of `gradeLemmaTyping` into `gradePronunciation(score)`; add `pronunciationScore?: number` to `GradeInput`. |
| [src/learn/learn.service.ts](../src/learn/learn.service.ts) | In `submitAnswer`, when `type === PRONUNCIATION` and `userAnswer` is a UUID, resolve the attempt and pass its `overallScore` into `grade()`. |
| [src/learn/learn.module.ts](../src/learn/learn.module.ts) | Register the `PronunciationAttempt` repo (`TypeOrmModule.forFeature`) **or** import `PronunciationModule` and reuse a lookup method. |

No DTO or migration change — `userAnswer` already accepts the UUID string.

### 5.1 Score -> quality map (tunable)

Align with the `good / practice / wrong` label thresholds. Starting point:

| overallScore | ReviewQuality |
|---|---|
| >= 85 | 5 |
| 75-84 | 4 |
| 60-74 | 3 |
| 45-59 | 3 |
| < 45 | 2 |

`correct = quality >= 3`. Tune after looking at real attempts — acoustic scoring is stricter than
STT-lenient, so err toward not over-penalising (the head is PCC ≈ 0.63, not perfect).

### 5.2 Replay / integrity checks

When resolving the attempt, require all of:
- `attempt.userId === current.id`,
- `attempt.vocabularyId === dto.vocabularyId`,
- `attempt.createdAt` within a freshness window (e.g. last 10 min),
- (optional) the attempt hasn't already been consumed by a prior `/answer`.

On any mismatch: treat as a failed production (quality 1/2), not a 500.

### 5.3 Graceful degradation (keep the loop resilient)

Today this step has **zero** server dependencies; acoustic scoring adds a runtime dependency on the
Python service. Keep the STT path as a fallback — the grader branches on `userAnswer`:
- **looks like a UUID** -> acoustic attempt lookup,
- **otherwise** -> existing lenient transcript compare.

So if `/pronunciation/score` returns `503`, the client falls back to STT and submits the transcript
exactly as today. Nothing regresses.

## 6. Audio format

The scorer decodes **WAV/FLAC/OGG** only; web `MediaRecorder` is `webm/opus` and must be captured
as PCM->WAV client-side. Native mobile recording is easier. Send the matching MIME type.

## 7. Build order

1. `gradePronunciation` + `GradeInput.pronunciationScore` (+ unit tests for the score->quality map and the UUID/STT branch).
2. Attempt resolution + integrity checks in `LearnService.submitAnswer`; wire the repo in `LearnModule`.
3. Manual run: score a word via `/pronunciation/score`, submit its `attemptId` to `/answer`, assert the SRS event matches the mapped quality.
4. Tune thresholds against a handful of real recordings.

## 8. Testing

- **Unit:** score->quality boundaries (44/45/59/60/74/75/84/85); UUID-vs-transcript branch selection; integrity rejection (wrong owner / stale / vocab mismatch).
- **Integration:** end-to-end record -> score -> answer -> SRS row, plus the 503 STT-fallback path.

## 9. Open questions

- Freshness window length and whether to mark attempts consumed.
- Whether to surface per-phoneme feedback in the learn answer result (today it returns
  correct/quality only — richer feedback means returning the phoneme array).
