import { Expose, Type } from 'class-transformer';
import type {
  AudioQuality,
  PhonemeLabel,
  PhonemeScore,
} from '@/pronunciation/pronunciation.types';

export class PhonemeScoreDto implements PhonemeScore {
  @Expose() phone!: string;
  @Expose() score!: number;
  @Expose() label!: PhonemeLabel;
  @Expose() start_sec!: number;
  @Expose() end_sec!: number;
}

export class AudioQualityDto implements AudioQuality {
  @Expose() duration_sec!: number;
  @Expose() too_short!: boolean;
  @Expose() clipping!: boolean;
  @Expose() snr_db!: number;
}

/** Response for POST /v1/pronunciation/score. */
export class ScoreAttemptResponseDto {
  @Expose() attemptId!: string;
  @Expose() word!: string;
  @Expose() transcriptPhonemes!: string[];
  @Expose() overallScore!: number;

  @Expose()
  @Type(() => PhonemeScoreDto)
  phonemes!: PhonemeScoreDto[];

  @Expose()
  @Type(() => AudioQualityDto)
  audioQuality!: AudioQualityDto;

  @Expose() modelVersion!: string;
  @Expose() createdAt!: Date;
}

/** One row in GET /v1/pronunciation/attempts. */
export class AttemptSummaryDto {
  @Expose() id!: string;
  @Expose() vocabularyId!: string | null;
  @Expose() word!: string;
  @Expose() overallScore!: number;

  @Expose()
  @Type(() => PhonemeScoreDto)
  phonemeScores!: PhonemeScoreDto[];

  @Expose() modelVersion!: string;
  @Expose() createdAt!: Date;
}

export class PaginatedAttemptsResponseDto {
  @Expose()
  @Type(() => AttemptSummaryDto)
  data!: AttemptSummaryDto[];

  @Expose() page!: number;
  @Expose() limit!: number;
  @Expose() total!: number;
}
