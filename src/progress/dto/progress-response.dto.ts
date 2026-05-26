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
