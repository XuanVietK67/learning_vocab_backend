import { Expose } from 'class-transformer';
import { VocabEnrichmentJobStatus } from '@/vocabularies/entities/vocab-enrichment-job-status.enum';

/**
 * Status of a quick-create enrichment job. `resultVocabularyIds` holds the draft
 * vocabularies the worker produced (one per resolved part of speech); empty
 * while pending, or when every part of speech already existed.
 */
export class EnrichmentJobResponseDto {
  @Expose() id!: string;
  @Expose() language!: string;
  @Expose() lemma!: string;
  @Expose() status!: VocabEnrichmentJobStatus;
  @Expose() resultVocabularyIds!: string[];
  @Expose() error!: string | null;
  @Expose() createdAt!: Date;
  @Expose() updatedAt!: Date;
}
