# Calling the Pronunciation Scoring service from a NestJS backend

How a NestJS backend forwards a user's recording to the deployed pronunciation-scoring
service and returns the per-phone scores.

```
Browser (MediaRecorder → webm)
   │  multipart: audio + word
   ▼
NestJS backend  ──Authorization: Bearer <HF_TOKEN>──►  HF Space  POST /score
   ▲                                                        │
   └──────────────── ScoreResponse JSON ◄───────────────────┘
```

The NestJS backend is the **only** thing that holds the HF token. The browser never
talks to the Space directly.

---

## 1. The service contract

Base URL of the deployed Space (note: the underscore in the Space name becomes a hyphen
in the host):

```
https://xuanvietdev-pronunciation-score.hf.space
```

### `POST /score`

- **Content-Type:** `multipart/form-data`
- **Fields:**
  | field   | type            | notes |
  |---------|-----------------|-------|
  | `audio` | file (binary)   | wav/flac/ogg **or** browser webm/opus, mp4/m4a, mp3. |
  | `word`  | text            | the target word being practiced, e.g. `water`. |
- **Auth:** `Authorization: Bearer <HF_TOKEN>` (the Space is private).

### `GET /health`

Returns readiness — use it for a warm-up ping / liveness check:

```json
{ "status": "ok", "model": "...", "model_version": "gopt-wav2vec2-espeak-v1", "trained_head": true, "ready": true }
```

### Success response (`200`)

```json
{
  "word": "water",
  "transcript_phonemes": ["w", "ɔ", "t", "ɚ"],
  "overall_score": 82,
  "phonemes": [
    { "phone": "w", "score": 90, "label": "good", "start_sec": 0.0, "end_sec": 0.12 },
    { "phone": "ɔ", "score": 78, "label": "good", "start_sec": 0.12, "end_sec": 0.30 }
  ],
  "audio_quality": { "duration_sec": 0.74, "too_short": false, "clipping": false, "snr_db": 41.2 },
  "model_version": "gopt-wav2vec2-espeak-v1"
}
```

### Error responses

| Status | Meaning | What the backend should do |
|--------|---------|----------------------------|
| `422`  | Audio rejected: too short, undecodable, or the word produced unmappable phones. The `detail` field explains. | Surface a friendly "couldn't read that recording, try again" to the user (`400`). |
| `503`  | Model still loading (cold start / Space just woke). | **Retry** with backoff (see §4). |
| `500`  | Server misconfig (e.g. ffmpeg missing — shouldn't happen in the deployed image). | Log + alert; return `502/503` to the user. |

> **Cold start:** the free CPU Space **sleeps after ~48h idle**. The first request after
> a sleep reboots the container (model load + warmup) and can take **30–60 s** or return
> `503` briefly. Set a generous timeout and retry — see §4.

---

## 2. Configuration

`.env` (never commit the token; load it from your secrets manager in prod):

```dotenv
PRONUNCIATION_SERVICE_URL=https://xuanvietdev-pronunciation-score.hf.space
PRONUNCIATION_SERVICE_TOKEN=hf_xxxxxxxxxxxxxxxxxxxxx
```

Install dependencies:

```bash
npm i @nestjs/axios axios form-data
npm i -D @types/multer
```

---

## 3. Implementation

### `pronunciation.types.ts`

```ts
export type PhonemeLabel = 'good' | 'practice' | 'wrong';

export interface PhonemeScore {
  phone: string;
  score: number;        // 0–100
  label: PhonemeLabel;
  start_sec: number;
  end_sec: number;
}

export interface AudioQuality {
  duration_sec: number;
  too_short: boolean;
  clipping: boolean;
  snr_db: number;
}

export interface ScoreResponse {
  word: string;
  transcript_phonemes: string[];
  overall_score: number;       // 0–100
  phonemes: PhonemeScore[];
  audio_quality: AudioQuality;
  model_version: string;
}
```

### `pronunciation.service.ts`

```ts
import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AxiosError } from 'axios';
import * as FormData from 'form-data';
import { firstValueFrom } from 'rxjs';
import { ScoreResponse } from './pronunciation.types';

@Injectable()
export class PronunciationService {
  private readonly logger = new Logger(PronunciationService.name);
  private readonly baseUrl = process.env.PRONUNCIATION_SERVICE_URL!;
  private readonly token = process.env.PRONUNCIATION_SERVICE_TOKEN!;

  constructor(private readonly http: HttpService) {}

  /** Score one recording. Retries cold-start 503s / timeouts (free Space wake-up). */
  async score(audio: Buffer, filename: string, word: string): Promise<ScoreResponse> {
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.postScore(audio, filename, word);
      } catch (err) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;
        const isColdStart =
          status === 503 || axiosErr.code === 'ECONNABORTED'; // 503 or timeout
        if (isColdStart && attempt < maxAttempts) {
          const waitMs = 2000 * attempt; // 2s, 4s
          this.logger.warn(
            `scoring cold-start (attempt ${attempt}/${maxAttempts}), retrying in ${waitMs}ms`,
          );
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw this.translate(axiosErr);
      }
    }
    // unreachable, but keeps the type checker happy
    throw new ServiceUnavailableException('pronunciation scoring unavailable');
  }

  private async postScore(audio: Buffer, filename: string, word: string) {
    const form = new FormData();
    form.append('audio', audio, { filename });
    form.append('word', word);

    const { data } = await firstValueFrom(
      this.http.post<ScoreResponse>(`${this.baseUrl}/score`, form, {
        headers: {
          ...form.getHeaders(),
          Authorization: `Bearer ${this.token}`,
        },
        timeout: 60_000,            // cold wake can take ~30–60s
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }),
    );
    return data;
  }

  private translate(err: AxiosError): Error {
    const status = err.response?.status;
    const detail = (err.response?.data as { detail?: string } | undefined)?.detail;

    if (status === 422) {
      // Bad recording / word — a client problem, surface as 400.
      return new BadRequestException(detail ?? 'audio could not be scored');
    }
    if (status === 503) {
      return new ServiceUnavailableException('scoring model is starting, try again shortly');
    }
    this.logger.error(`scoring failed: status=${status} msg=${err.message}`);
    return new ServiceUnavailableException('pronunciation scoring unavailable');
  }

  /** Optional: ping /health to wake/warm the Space before a lesson starts. */
  async isReady(): Promise<boolean> {
    try {
      const { data } = await firstValueFrom(
        this.http.get<{ ready: boolean }>(`${this.baseUrl}/health`, {
          headers: { Authorization: `Bearer ${this.token}` },
          timeout: 10_000,
        }),
      );
      return data.ready === true;
    } catch {
      return false;
    }
  }
}
```

### `pronunciation.controller.ts`

Receives the upload from the frontend (Multer) and forwards the buffer:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { PronunciationService } from './pronunciation.service';
import { ScoreResponse } from './pronunciation.types';

@Controller('pronunciation')
export class PronunciationController {
  constructor(private readonly pronunciation: PronunciationService) {}

  @Post('score')
  @UseInterceptors(
    FileInterceptor('audio', { limits: { fileSize: 10 * 1024 * 1024 } }), // 10 MB cap
  )
  async score(
    @UploadedFile() audio: Express.Multer.File,
    @Body('word') word: string,
  ): Promise<ScoreResponse> {
    if (!audio) throw new BadRequestException('audio file is required');
    if (!word?.trim()) throw new BadRequestException('word is required');

    return this.pronunciation.score(
      audio.buffer,
      audio.originalname || 'recording.webm',
      word.trim(),
    );
  }
}
```

### `pronunciation.module.ts`

```ts
import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { PronunciationController } from './pronunciation.controller';
import { PronunciationService } from './pronunciation.service';

@Module({
  imports: [HttpModule],
  controllers: [PronunciationController],
  providers: [PronunciationService],
  exports: [PronunciationService],
})
export class PronunciationModule {}
```

---

## 4. Operational notes

- **Cold start handling is not optional** on the free tier — keep the 60 s timeout and the
  503/timeout retry. Optionally call `isReady()` (or hit `/health`) when a user opens a
  lesson, so the Space is warm by the time they record.
- **Keep the multipart field names exactly `audio` and `word`** — the service reads those.
- **Browser audio just works:** `MediaRecorder` produces webm/opus, which the service
  decodes via ffmpeg. The filename/extension is cosmetic (the decoder sniffs the content).
- **Never expose `PRONUNCIATION_SERVICE_TOKEN` to the frontend.** It lives only in the
  backend env / secrets manager.
- **Size cap:** the controller rejects uploads > 10 MB; single-word clips are tiny, so this
  just guards against abuse.

---

## 5. Quick smoke test (without the frontend)

```bash
curl -H "Authorization: Bearer $PRONUNCIATION_SERVICE_TOKEN" \
     https://xuanvietdev-pronunciation-score.hf.space/health

curl -H "Authorization: Bearer $PRONUNCIATION_SERVICE_TOKEN" \
     -F "audio=@word.wav" -F "word=water" \
     https://xuanvietdev-pronunciation-score.hf.space/score
```
