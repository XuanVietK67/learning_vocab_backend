import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ScoreServiceResponse } from '@/pronunciation/pronunciation.types';

export interface AudioPayload {
  buffer: Buffer;
  mimetype: string;
  filename: string;
}

/**
 * Raised internally for cold-start signals (HTTP 503 or a request timeout) so
 * `score()` knows the attempt is worth retrying. Never escapes this class.
 */
class ColdStartError extends Error {}

/**
 * Thin HTTP client for the phoneme-scoring service. Targets either a local
 * FastAPI instance or the deployed (private) HF Space — when a Bearer token is
 * configured it is sent on every request. Uses the global `fetch`/`FormData`
 * (Node 20+) so no extra dependency is needed. The free Space cold-starts
 * (~30–60s) after idle, so cold-start signals are retried with backoff. Maps
 * upstream failures to Nest exceptions; never leaks raw fetch/network errors.
 */
@Injectable()
export class PronunciationScoringClient {
  private readonly logger = new Logger(PronunciationScoringClient.name);
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;

  constructor(config: ConfigService) {
    this.baseUrl = config
      .getOrThrow<string>('pronunciation.serviceUrl')
      .replace(/\/+$/, '');
    this.token = config.get<string>('pronunciation.token') ?? '';
    this.timeoutMs = config.get<number>('pronunciation.timeoutMs') ?? 60000;
    this.maxAttempts = Math.max(
      1,
      config.get<number>('pronunciation.maxAttempts') ?? 3,
    );
  }

  /**
   * Score one recording, retrying cold-start 503s / timeouts (free Space
   * wake-up) with linear backoff. Client errors (422) fail immediately.
   */
  async score(
    audio: AudioPayload,
    word: string,
  ): Promise<ScoreServiceResponse> {
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.attemptScore(audio, word);
      } catch (err) {
        if (!(err instanceof ColdStartError)) throw err;
        if (attempt >= this.maxAttempts) {
          this.logger.error(
            `scoring cold-start did not clear after ${this.maxAttempts} attempts: ${err.message}`,
          );
          throw new ServiceUnavailableException(
            'pronunciation scoring model is starting, try again shortly',
          );
        }
        const waitMs = 2000 * attempt; // 2s, 4s, ...
        this.logger.warn(
          `scoring cold-start (attempt ${attempt}/${this.maxAttempts}), retrying in ${waitMs}ms: ${err.message}`,
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    // Unreachable (loop either returns or throws), but keeps the type checker happy.
    throw new ServiceUnavailableException(
      'pronunciation scoring service is unavailable',
    );
  }

  private async attemptScore(
    audio: AudioPayload,
    word: string,
  ): Promise<ScoreServiceResponse> {
    const form = new FormData();
    form.append(
      'audio',
      new Blob([new Uint8Array(audio.buffer)], {
        type: audio.mimetype || 'application/octet-stream',
      }),
      audio.filename || 'audio.wav',
    );
    form.append('word', word);

    // The Space is private; send the Bearer token when configured. fetch sets
    // the multipart Content-Type (with boundary) from the FormData body itself.
    const headers: Record<string, string> = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/score`, {
        method: 'POST',
        body: form,
        headers,
        signal: controller.signal,
      });
    } catch (err) {
      // A timeout usually means the Space is cold-starting — retryable.
      if (err instanceof Error && err.name === 'AbortError') {
        throw new ColdStartError(`timed out after ${this.timeoutMs}ms`);
      }
      this.logger.error(
        `scoring service unreachable: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException(
        'pronunciation scoring service is unavailable',
      );
    } finally {
      clearTimeout(timer);
    }

    // 422 = the service rejected this audio/word (too short, unmapped phones,
    // no phones for the word). Surface its reason as a client error.
    if (res.status === 422) {
      throw new BadRequestException(
        (await this.readDetail(res)) ?? 'audio could not be scored',
      );
    }
    // 503 = model still loading (cold start / Space just woke) — retryable.
    if (res.status === 503) {
      throw new ColdStartError('scoring model is still loading (503)');
    }
    if (!res.ok) {
      this.logger.error(`scoring service returned HTTP ${res.status}`);
      throw new ServiceUnavailableException(
        'pronunciation scoring service error',
      );
    }

    return (await res.json()) as ScoreServiceResponse;
  }

  /** FastAPI HTTPException bodies look like `{ "detail": "..." }`. */
  private async readDetail(res: Response): Promise<string | null> {
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') return body.detail;
      return body.detail ? JSON.stringify(body.detail) : null;
    } catch {
      return null;
    }
  }
}
