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
 * Thin HTTP client for the Python FastAPI scoring service. Uses the global
 * `fetch`/`FormData` (Node 20+) so no extra dependency is needed. Maps upstream
 * failures to Nest exceptions; never leaks raw fetch/network errors.
 */
@Injectable()
export class PronunciationScoringClient {
  private readonly logger = new Logger(PronunciationScoringClient.name);
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: ConfigService) {
    this.baseUrl = config
      .getOrThrow<string>('pronunciation.serviceUrl')
      .replace(/\/+$/, '');
    this.timeoutMs = config.get<number>('pronunciation.timeoutMs') ?? 8000;
  }

  async score(
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

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/score`, {
        method: 'POST',
        body: form,
        signal: controller.signal,
      });
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'AbortError'
          ? `timed out after ${this.timeoutMs}ms`
          : (err as Error).message;
      this.logger.error(`scoring service unreachable: ${reason}`);
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
