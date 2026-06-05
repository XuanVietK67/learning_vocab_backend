import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import {
  PRACTICE_SCORING_QUEUE,
  SCORE_SENTENCE_JOB,
  ScoreSentenceJobData,
} from '@/practice/scoring-queue.constants';

@Injectable()
export class ScoringQueueProducer {
  constructor(
    @InjectQueue(PRACTICE_SCORING_QUEUE)
    private readonly queue: Queue<ScoreSentenceJobData>,
  ) {}

  /**
   * Enqueue a scoring job for a freshly created attempt. Unlike the audio
   * producer, a failure here must propagate: the attempt row is the user's
   * submission and would otherwise be orphaned in `pending`, so the caller
   * marks it failed / returns an error rather than silently dropping it.
   *
   * `attempts`/`backoff` let the worker ride out free-tier 429s by retrying
   * with exponential backoff instead of failing the user.
   */
  async enqueue(attemptId: string): Promise<void> {
    const opts: JobsOptions = {
      jobId: attemptId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: true,
      removeOnFail: 500,
    };
    await this.queue.add(SCORE_SENTENCE_JOB, { attemptId }, opts);
  }
}
