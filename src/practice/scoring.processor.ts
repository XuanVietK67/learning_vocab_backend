import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { Repository } from 'typeorm';
import { ProductionAttempt } from '@/practice/entities/production-attempt.entity';
import { ScoringStatus } from '@/practice/entities/scoring-status.enum';
import { scoreSentence } from '@/practice/gemma-judge';
import {
  PRACTICE_SCORING_QUEUE,
  ScoreSentenceJobData,
} from '@/practice/scoring-queue.constants';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

// Decorator options are evaluated at class-decoration time, before Nest's DI
// (and ConfigService) exists, so concurrency + the rate limiter are read from
// env directly. The limiter caps how many jobs start per window, keeping the
// worker under the Gemma free-tier RPM.
const CONCURRENCY = parseInt(process.env.GEMMA_WORKER_CONCURRENCY ?? '1', 10);
const RPM = parseInt(process.env.GEMMA_REQUESTS_PER_MINUTE ?? '15', 10);

@Processor(PRACTICE_SCORING_QUEUE, {
  concurrency: CONCURRENCY,
  limiter: { max: RPM, duration: 60_000 },
})
export class ScoringProcessor extends WorkerHost {
  private readonly logger = new Logger(ScoringProcessor.name);

  constructor(
    @InjectRepository(ProductionAttempt)
    private readonly attemptRepo: Repository<ProductionAttempt>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    private readonly config: ConfigService,
  ) {
    super();
  }

  async process(job: Job<ScoreSentenceJobData>): Promise<void> {
    const { attemptId } = job.data;

    const attempt = await this.attemptRepo.findOne({
      where: { id: attemptId },
    });
    if (!attempt) {
      this.logger.warn(`attempt ${attemptId} no longer exists; skipping`);
      return;
    }
    // Idempotency: a previous run may already have scored (or failed) it.
    if (attempt.status !== ScoringStatus.PENDING) {
      return;
    }

    const vocab = await this.vocabRepo.findOne({
      where: { id: attempt.vocabularyId },
      relations: { senses: true },
    });
    if (!vocab) {
      // Permanent error — retrying won't help, so fail immediately.
      await this.markFailed(attemptId, 'vocabulary not found');
      return;
    }

    const senseGlosses = (vocab.senses ?? [])
      .map((s) => s.gloss ?? s.definition)
      .filter((g): g is string => Boolean(g && g.trim()))
      .slice(0, 5);

    const { rubric, model } = await scoreSentence(
      {
        lemma: vocab.lemma,
        partOfSpeech: vocab.partOfSpeech,
        senseGlosses,
        sentence: attempt.submittedText,
      },
      {
        apiKeys: this.config.getOrThrow<string[]>('gemma.apiKeys'),
        baseUrl: this.config.getOrThrow<string>('gemma.baseUrl'),
        model: this.config.getOrThrow<string>('gemma.model'),
        timeoutMs: this.config.get<number>('gemma.timeoutMs', 30_000),
      },
    );

    // Only write if still pending, to avoid racing a concurrent run.
    await this.attemptRepo.update(
      { id: attemptId, status: ScoringStatus.PENDING },
      {
        status: ScoringStatus.SCORED,
        score: rubric.overall,
        cefr: rubric.cefr,
        rubric,
        feedback: rubric.feedback,
        model,
        error: null,
        scoredAt: new Date(),
      },
    );
    this.logger.log(
      `scored attempt ${attemptId} (${rubric.overall}, ${rubric.cefr})`,
    );
  }

  // Fires after every failed attempt. Only persist `failed` once BullMQ has
  // exhausted its retries — earlier failures are transient (rate limit, network,
  // a one-off unparseable response) and will be retried with backoff.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<ScoreSentenceJobData>, err: Error): Promise<void> {
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) {
      this.logger.warn(
        `attempt ${job.data.attemptId} scoring failed ` +
          `(try ${job.attemptsMade}/${maxAttempts}): ${err.message}`,
      );
      return;
    }
    await this.markFailed(job.data.attemptId, err.message);
    this.logger.error(
      `attempt ${job.data.attemptId} scoring gave up: ${err.message}`,
    );
  }

  private async markFailed(attemptId: string, reason: string): Promise<void> {
    await this.attemptRepo.update(
      { id: attemptId, status: ScoringStatus.PENDING },
      { status: ScoringStatus.FAILED, error: reason.slice(0, 1000) },
    );
  }
}
