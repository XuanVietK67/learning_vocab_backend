/** Shared queue name + job payload contract between the API producer and the
 * enrichment worker consumer. Keep this free of NestJS imports so both sides
 * can use it. */

export const ENRICHMENT_QUEUE = 'vocab-enrichment';

export const ENRICH_VOCABULARY_JOB = 'enrich-vocabulary';

export interface EnrichVocabularyJobData {
  jobId: string;
}
