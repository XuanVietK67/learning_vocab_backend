import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import {
  ENRICHMENT_QUEUE,
  ENRICH_VOCABULARY_JOB,
  EnrichVocabularyJobData,
} from '@/vocabularies/enrichment/enrichment-queue.constants';

@Injectable()
export class EnrichmentQueueProducer {
  private readonly logger = new Logger(EnrichmentQueueProducer.name);

  constructor(
    @InjectQueue(ENRICHMENT_QUEUE)
    private readonly queue: Queue<EnrichVocabularyJobData>,
  ) {}

  /**
   * Enqueue an enrichment job for a freshly created quick-create request. Uses
   * the DB job id as the BullMQ job id so repeat enqueues de-duplicate. A
   * queue/Redis outage must never fail the request, so failures are swallowed
   * with a warning — the job row stays `pending` and can be retried.
   */
  async enqueue(jobId: string): Promise<void> {
    const opts: JobsOptions = {
      jobId,
      // Gemma 429/503 spikes are transient but can last minutes; the custom
      // strategy (EnrichmentProcessor.enrichmentBackoff) is exponential with
      // jitter so the fanned-out per-lemma jobs don't retry in lockstep.
      attempts: parseInt(process.env.ENRICHMENT_MAX_ATTEMPTS ?? '5', 10),
      backoff: { type: 'custom' },
      removeOnComplete: true,
      removeOnFail: 100,
    };
    try {
      await this.queue.add(ENRICH_VOCABULARY_JOB, { jobId }, opts);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`failed to enqueue enrichment job ${jobId}: ${msg}`);
    }
  }
}
