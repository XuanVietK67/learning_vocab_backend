import { Expose } from 'class-transformer';

/**
 * Aggregate progress of a bulk quick-create batch. `resultVocabularyIds` is the
 * flattened set of draft vocabularies the batch's jobs have produced so far.
 */
export class EnrichmentBatchResponseDto {
  @Expose() batchId!: string;
  @Expose() total!: number;
  @Expose() pending!: number;
  @Expose() completed!: number;
  @Expose() failed!: number;
  @Expose() resultVocabularyIds!: string[];
}
