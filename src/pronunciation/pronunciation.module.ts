import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { PronunciationAttempt } from '@/pronunciation/entities/pronunciation-attempt.entity';
import { PronunciationController } from '@/pronunciation/pronunciation.controller';
import { PronunciationScoringClient } from '@/pronunciation/pronunciation-scoring.client';
import { PronunciationService } from '@/pronunciation/pronunciation.service';

@Module({
  imports: [TypeOrmModule.forFeature([PronunciationAttempt, Vocabulary])],
  controllers: [PronunciationController],
  providers: [PronunciationService, PronunciationScoringClient],
})
export class PronunciationModule {}
