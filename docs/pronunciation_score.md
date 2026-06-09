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
| `audio` | yes | file | WAV / FLAC / OGG, **≤ 5 MB**. See the audio-format note below. |
| `vocabularyId` | one of | string | UUID of a catalog/owned vocabulary. The word scored is its `lemma`. |
| `word` | one of | string | Free-text word, 1–128 chars. Use when there is no `vocabularyId`. |

Send **exactly one** of `vocabularyId` or `word` — sending both, or neither, is a `400`.

### Example (browser)

```js
const form = new FormData();
form.append('audio', wavBlob, 'thin.wav'); // a WAV Blob
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
| `503` | Scoring service unreachable or timed out. |

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

- **Audio format:** the scoring service decodes **WAV / FLAC / OGG** only. Browser `MediaRecorder` usually produces `webm/opus`, which is **rejected**. Either record/encode WAV (e.g. capture PCM via the Web Audio API and wrap it as a WAV Blob) or transcode before upload. Send the matching MIME type (`audio/wav`, `audio/flac`, `audio/ogg`).
- **Don't set `Content-Type` manually** on the `fetch`/upload — let the client set the multipart boundary.
- **Latency:** scoring runs on CPU; expect a few hundred ms once the service is warm. The backend times out the upstream call at `PRONUNCIATION_TIMEOUT_MS` (default 8 s) and returns `503` on timeout — surface a retry affordance.
- **Audio quality gate:** a very short clip is rejected with `400` ("audio too short"). Use `audioQuality` in the response to warn on `clipping` or low `snr_db`.
