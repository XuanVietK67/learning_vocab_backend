import {
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThanOrEqual, Repository } from 'typeorm';
import {
  AttemptAcceptedDto,
  AttemptResultDto,
} from '@/practice/dto/attempt-response.dto';
import { SubmitAttemptDto } from '@/practice/dto/submit-attempt.dto';
import { ProductionAttempt } from '@/practice/entities/production-attempt.entity';
import { ScoringStatus } from '@/practice/entities/scoring-status.enum';
import { ScoringQueueProducer } from '@/practice/scoring-queue.producer';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Injectable()
export class PracticeService {
  private readonly logger = new Logger(PracticeService.name);

  constructor(
    @InjectRepository(ProductionAttempt)
    private readonly attemptRepo: Repository<ProductionAttempt>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    private readonly producer: ScoringQueueProducer,
    private readonly config: ConfigService,
  ) {}

  /**
   * Create a pending attempt and enqueue it for async scoring. Enforces a
   * per-user daily cap first (the Gemma free tier is one shared key). If the
   * queue is unreachable the row is rolled back and a 503 is returned, so an
   * attempt is never orphaned in `pending`.
   */
  async submit(
    userId: string,
    dto: SubmitAttemptDto,
  ): Promise<AttemptAcceptedDto> {
    const vocab = await this.vocabRepo.findOne({
      where: { id: dto.vocabularyId },
      select: { id: true },
    });
    if (!vocab) throw new NotFoundException('vocabulary not found');

    await this.assertUnderDailyCap(userId);

    const attempt = await this.attemptRepo.save(
      this.attemptRepo.create({
        userId,
        vocabularyId: dto.vocabularyId,
        modality: dto.modality,
        submittedText: dto.text.trim(),
        status: ScoringStatus.PENDING,
      }),
    );

    try {
      await this.producer.enqueue(attempt.id);
    } catch (err) {
      // Roll back so the row isn't stuck pending and doesn't burn the quota.
      await this.attemptRepo.delete({ id: attempt.id });
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`failed to enqueue scoring for ${attempt.id}: ${msg}`);
      throw new ServiceUnavailableException('scoring queue unavailable');
    }

    return { attemptId: attempt.id, status: attempt.status };
  }

  /** Fetch one attempt owned by the user. */
  async getResult(
    userId: string,
    attemptId: string,
  ): Promise<AttemptResultDto> {
    const attempt = await this.attemptRepo.findOne({
      where: { id: attemptId, userId },
    });
    if (!attempt) throw new NotFoundException('attempt not found');
    return toResultDto(attempt);
  }

  private async assertUnderDailyCap(userId: string): Promise<void> {
    const cap = this.config.get<number>('gemma.dailyAttemptsPerUser', 30);
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const usedToday = await this.attemptRepo.count({
      where: { userId, createdAt: MoreThanOrEqual(startOfDay) },
    });
    if (usedToday >= cap) {
      throw new HttpException(
        `daily practice limit reached (${cap}/day)`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

function toResultDto(a: ProductionAttempt): AttemptResultDto {
  return {
    id: a.id,
    vocabularyId: a.vocabularyId,
    modality: a.modality,
    text: a.submittedText,
    status: a.status,
    score: a.score,
    cefr: a.cefr,
    rubric: a.rubric,
    feedback: a.feedback,
    error: a.error,
    createdAt: a.createdAt.toISOString(),
    scoredAt: a.scoredAt ? a.scoredAt.toISOString() : null,
  };
}
