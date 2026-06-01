import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import {
  AUDIO_QUEUE,
  GENERATE_AUDIO_JOB,
  GenerateAudioJobData,
} from '@/vocabularies/audio/audio-queue.constants';

@Injectable()
export class AudioQueueProducer {
  private readonly logger = new Logger(AudioQueueProducer.name);

  constructor(
    @InjectQueue(AUDIO_QUEUE)
    private readonly queue: Queue<GenerateAudioJobData>,
  ) {}

  /**
   * Enqueue an audio-generation job for a freshly created vocabulary. Uses the
   * vocab id as the job id so repeat enqueues for the same word de-duplicate.
   * A queue/Redis outage must never fail the create, so failures are swallowed
   * with a warning — the backfill script remains the safety net.
   */
  async enqueue(
    vocabId: string,
    lemma: string,
    language: string,
  ): Promise<void> {
    // Use the vocab id as the job id so repeat enqueues de-duplicate.
    const opts: JobsOptions = {
      jobId: vocabId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    };
    try {
      await this.queue.add(
        GENERATE_AUDIO_JOB,
        { vocabId, lemma, language },
        opts,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`failed to enqueue audio job for ${vocabId}: ${msg}`);
    }
  }
}
