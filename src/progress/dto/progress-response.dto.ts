import { Expose, Type } from 'class-transformer';
import { ProgressStatus } from '@/progress/entities/progress-status.enum';
import { VocabularyResponseDto } from '@/vocabularies/dto/vocabulary-response.dto';

export class ProgressResponseDto {
  @Expose() id!: string;
  @Expose() vocabularyId!: string;
  @Expose() status!: ProgressStatus;
  @Expose() repetitions!: number;
  @Expose() easeFactor!: number;
  @Expose() intervalDays!: number;
  // null = graduated to the day-scale SM-2 ladder.
  // 0..N-1 = card is currently at that index in the configured learning
  // steps (intra-session repetition). Surface for clients that want to
  // show "step 1 of 2" UI; safe to ignore otherwise.
  @Expose() learningStepIndex!: number | null;
  @Expose() nextReviewAt!: Date;
  @Expose() lastReviewedAt!: Date | null;
  @Expose() correctCount!: number;
  @Expose() incorrectCount!: number;
}

export class DueCardResponseDto extends ProgressResponseDto {
  @Expose()
  @Type(() => VocabularyResponseDto)
  vocabulary!: VocabularyResponseDto;
}
