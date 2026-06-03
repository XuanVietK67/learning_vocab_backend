import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PronunciationAttempt } from '@/pronunciation/entities/pronunciation-attempt.entity';
import { PronunciationResultDto } from '@/pronunciation/dto/pronunciation-result.dto';
import { SubmitPronunciationDto } from '@/pronunciation/dto/submit-pronunciation.dto';
import { assessPronunciation } from '@/pronunciation/speech/azure-speech.client';
import { transcodeToPcm } from '@/pronunciation/speech/audio-transcoder';
import {
  AudioDecodeError,
  AudioTooLongError,
  NoSpeechDetectedError,
  SpeechServiceError,
} from '@/pronunciation/speech/errors';
import { normalizeLocale } from '@/pronunciation/speech/locale';

@Injectable()
export class PronunciationService {
  private readonly logger = new Logger(PronunciationService.name);

  constructor(
    @InjectRepository(PronunciationAttempt)
    private readonly attemptRepo: Repository<PronunciationAttempt>,
    private readonly config: ConfigService,
  ) {}

  /**
   * Transcode the uploaded clip, score it with Azure Pronunciation Assessment,
   * persist the attempt, and return the scores. The audio is discarded (temp
   * file unlinked) regardless of outcome.
   */
  async score(
    userId: string,
    file: Express.Multer.File | undefined,
    dto: SubmitPronunciationDto,
  ): Promise<PronunciationResultDto> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('audio file is required');
    }

    const defaultLocale = this.config.getOrThrow<string>(
      'pronunciation.azure.defaultLocale',
    );
    const locale = normalizeLocale(dto.locale ?? defaultLocale);
    if (!locale) {
      throw new BadRequestException('unsupported locale');
    }

    const maxAudioSeconds = this.config.getOrThrow<number>(
      'pronunciation.maxAudioSeconds',
    );
    const tempPath = join(tmpdir(), `pron-${randomUUID()}`);

    try {
      await writeFile(tempPath, file.buffer);
      const pcm = await transcodeToPcm(tempPath, maxAudioSeconds);

      const result = await assessPronunciation(pcm, dto.referenceText, locale, {
        key: this.config.getOrThrow<string>('pronunciation.azure.key'),
        region: this.config.getOrThrow<string>('pronunciation.azure.region'),
      });

      const passThreshold = this.config.getOrThrow<number>(
        'pronunciation.passThreshold',
      );
      const attempt = this.attemptRepo.create({
        userId,
        vocabId: null,
        referenceText: dto.referenceText,
        recognizedText: result.recognizedText,
        locale,
        overallScore: result.overallScore,
        accuracyScore: result.accuracyScore,
        fluencyScore: result.fluencyScore,
        completenessScore: result.completenessScore,
        prosodyScore: result.prosodyScore,
        passed: result.overallScore >= passThreshold,
        phonemes: result.words,
      });
      const saved = await this.attemptRepo.save(attempt);

      return PronunciationResultDto.fromEntity(saved);
    } catch (err) {
      throw this.toHttpError(err);
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
  }

  // Map the speech pipeline's typed errors to HTTP responses; rethrow anything
  // already an HttpException (e.g. the BadRequests above) untouched.
  private toHttpError(err: unknown): Error {
    if (err instanceof AudioTooLongError) {
      return new BadRequestException(err.message);
    }
    if (err instanceof AudioDecodeError) {
      return new BadRequestException(err.message);
    }
    if (err instanceof NoSpeechDetectedError) {
      return new UnprocessableEntityException(err.message);
    }
    if (err instanceof SpeechServiceError) {
      this.logger.error(`scoring failed: ${err.message}`);
      return new BadGatewayException('pronunciation scoring is unavailable');
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}
