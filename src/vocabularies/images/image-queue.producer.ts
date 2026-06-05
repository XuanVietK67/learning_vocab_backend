import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import {
  GENERATE_IMAGE_JOB,
  GenerateImageJobData,
  IMAGE_QUEUE,
} from '@/vocabularies/images/image-queue.constants';

@Injectable()
export class ImageQueueProducer {
  private readonly logger = new Logger(ImageQueueProducer.name);

  constructor(
    @InjectQueue(IMAGE_QUEUE)
    private readonly queue: Queue<GenerateImageJobData>,
  ) {}

  /**
   * Enqueue an image-generation job for one sense. Uses the sense id as the job
   * id so repeat enqueues for the same sense de-duplicate. A queue/Redis outage
   * must never fail approval, so failures are swallowed with a warning — the
   * image backfill script remains the safety net.
   */
  async enqueue(
    senseId: string,
    lemma: string,
    language: string,
  ): Promise<void> {
    const opts: JobsOptions = {
      jobId: senseId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: true,
      removeOnFail: 100,
    };
    try {
      await this.queue.add(
        GENERATE_IMAGE_JOB,
        { senseId, lemma, language },
        opts,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`failed to enqueue image job for ${senseId}: ${msg}`);
    }
  }
}
