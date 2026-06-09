import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { AttemptsQueryDto } from '@/pronunciation/dto/attempts-query.dto';
import {
  PaginatedAttemptsResponseDto,
  ScoreAttemptResponseDto,
} from '@/pronunciation/dto/pronunciation-response.dto';
import { ScorePronunciationDto } from '@/pronunciation/dto/score-pronunciation.dto';
import { PronunciationAttempt } from '@/pronunciation/entities/pronunciation-attempt.entity';
import {
  AudioPayload,
  PronunciationScoringClient,
} from '@/pronunciation/pronunciation-scoring.client';

@Injectable()
export class PronunciationService {
  constructor(
    @InjectRepository(PronunciationAttempt)
    private readonly attemptRepo: Repository<PronunciationAttempt>,
    @InjectRepository(Vocabulary)
    private readonly vocabRepo: Repository<Vocabulary>,
    private readonly client: PronunciationScoringClient,
  ) {}

  async score(
    userId: string,
    dto: ScorePronunciationDto,
    file: Express.Multer.File,
  ): Promise<ScoreAttemptResponseDto> {
    let vocabularyId: string | null = null;
    let word: string;

    if (dto.vocabularyId) {
      const vocab = await this.vocabRepo.findOne({
        where: { id: dto.vocabularyId },
        select: { id: true, lemma: true },
      });
      if (!vocab) {
        throw new NotFoundException('vocabulary not found');
      }
      vocabularyId = vocab.id;
      word = vocab.lemma;
    } else {
      word = dto.word!.trim();
    }

    const audio: AudioPayload = {
      buffer: file.buffer,
      mimetype: file.mimetype,
      filename: file.originalname,
    };
    const result = await this.client.score(audio, word);

    const saved = await this.attemptRepo.save(
      this.attemptRepo.create({
        userId,
        vocabularyId,
        word,
        overallScore: result.overall_score,
        phonemeScores: result.phonemes,
        audioQuality: result.audio_quality,
        modelVersion: result.model_version,
      }),
    );

    return plainToInstance(
      ScoreAttemptResponseDto,
      {
        attemptId: saved.id,
        word: result.word,
        transcriptPhonemes: result.transcript_phonemes,
        overallScore: result.overall_score,
        phonemes: result.phonemes,
        audioQuality: result.audio_quality,
        modelVersion: result.model_version,
        createdAt: saved.createdAt,
      },
      { excludeExtraneousValues: true },
    );
  }

  async findAttempts(
    userId: string,
    query: AttemptsQueryDto,
  ): Promise<PaginatedAttemptsResponseDto> {
    const { vocabularyId, word, page, limit } = query;

    const qb = this.attemptRepo
      .createQueryBuilder('a')
      .where('a.user_id = :userId', { userId });

    if (vocabularyId) {
      qb.andWhere('a.vocabulary_id = :vocabularyId', { vocabularyId });
    }
    if (word) {
      qb.andWhere('a.word = :word', { word });
    }

    const [rows, total] = await qb
      .orderBy('a.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return plainToInstance(
      PaginatedAttemptsResponseDto,
      { data: rows, page, limit, total },
      { excludeExtraneousValues: true },
    );
  }
}
