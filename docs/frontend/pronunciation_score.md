# Pronunciation scoring

Two endpoints for phoneme-level pronunciation feedback:

- `POST /v1/pronunciation/score` — **JWT required**
- `GET /v1/pronunciation/attempts` — **JWT required**

The learner records themselves saying a target word; the backend forwards the audio to a Python scoring microservice and returns a `0–100` score per phoneme plus a coarse label, then stores the attempt for history/progress UI.

---

## `POST /v1/pronunciation/score`

Score one spoken word.

### Request

- **Method / path:** `POST /v1/pronunciation/score`
- **Headers:** `Authorization: Bearer <accessToken>`, `Content-Type: multipart/form-data`
- **Body (`multipart/form-data`):**

| Field | Required | Type | Rules |
|---|---|---|---|
| `audio` | yes | file | WAV / FLAC / OGG, **webm/opus, mp4/m4a or mp3**, **≤ 10 MB**. See the audio-format note below. |
| `vocabularyId` | one of | string | UUID of a catalog/owned vocabulary. The word scored is its `lemma`. |
| `word` | one of | string | Free-text word, 1–128 chars. Use when there is no `vocabularyId`. |

Send **exactly one** of `vocabularyId` or `word` — sending both, or neither, is a `400`.

### Example (browser)

```js
const form = new FormData();
// MediaRecorder webm/opus uploads directly — no client transcode needed.
form.append('audio', recordedBlob, 'thin.webm');
form.append('vocabularyId', 'c2a1f0de-1111-2222-3333-444455556666');

const res = await fetch('/v1/pronunciation/score', {
  method: 'POST',
  headers: { Authorization: `Bearer ${accessToken}` }, // do NOT set Content-Type — the browser sets the multipart boundary
  body: form,
});
```

### Response `201`

```json
{
  "attemptId": "a1b2c3d4-...",
  "word": "thin",
  "transcriptPhonemes": ["θ", "ɪ", "n"],
  "overallScore": 72,
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

- `overallScore` and per-phone `score` are integers `0–100`.
- `label` is one of `good` (score ≥ 75), `practice` (45–74), `wrong` (< 45).
- `phonemes[]` is ordered left-to-right; `start_sec`/`end_sec` are the aligned time span of each phone within the clip (useful for highlighting playback).
- `transcriptPhonemes` is the canonical espeak/IPA phone sequence the word was scored against.

### Errors

| Status | When |
|---|---|
| `400` | Validation: not exactly one of `vocabularyId`/`word`; `word` length; bad UUID; missing/oversized/wrong-type `audio`. Also returned when the scoring service rejects the audio (too short, or no/unmapped phones for the word). |
| `401` | Missing/invalid JWT. |
| `404` | `vocabularyId` not found. |
| `503` | Scoring service unreachable, or still cold-starting after the backend's retries (see latency note). |

---

## `GET /v1/pronunciation/attempts`

The caller's own attempt history, newest first.

### Request

- **Headers:** `Authorization: Bearer <accessToken>`
- **Query params (all optional):**

| Name | Type | Notes |
|---|---|---|
| `vocabularyId` | string (uuid) | Filter to one vocabulary. |
| `word` | string | Filter by exact word (1–128 chars). |
| `page` | int | Default `1`. |
| `limit` | int | Default `20`, max `100`. |

### Response `200`

```json
{
  "data": [
    {
      "id": "a1b2c3d4-...",
      "vocabularyId": "c2a1f0de-...",
      "word": "thin",
      "overallScore": 72,
      "phonemeScores": [
        { "phone": "θ", "score": 64, "label": "practice", "start_sec": 0.12, "end_sec": 0.20 }
      ],
      "modelVersion": "gopt-wav2vec2-espeak-v1",
      "createdAt": "2026-06-09T10:25:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 7
}
```

`vocabularyId` is `null` for attempts scored by free-text `word`.

---

## Client notes

- **Audio format:** the scoring service decodes via ffmpeg, so browser `MediaRecorder` output (`webm/opus`, or `mp4` on Safari), plus `mp3` and WAV/FLAC/OGG, all upload directly — **no client-side transcode needed**. Just send the blob with its native MIME type (`audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/wav`, …).
- **Don't set `Content-Type` manually** on the `fetch`/upload — let the client set the multipart boundary.
- **Latency & cold start:** once warm, scoring takes ~a few hundred ms. The service sleeps after long idle and the **first** request can take **30–60 s** while it wakes. The backend retries cold-start signals (timeout / `503`) before returning `503`, so show a "warming up…" state on the first attempt and a retry affordance if it still fails.
- **Audio quality gate:** a very short clip is rejected with `400` ("audio too short"). Use `audioQuality` in the response to warn on `clipping` or low `snr_db`.
