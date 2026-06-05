import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductionAttempt } from '@/practice/entities/production-attempt.entity';
import { PracticeController } from '@/practice/practice.controller';
import { PracticeService } from '@/practice/practice.service';
import { PRACTICE_SCORING_QUEUE } from '@/practice/scoring-queue.constants';
import { ScoringQueueProducer } from '@/practice/scoring-queue.producer';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

// API-side module: the producer + HTTP surface. The scoring consumer
// (ScoringProcessor) runs in the separate worker process (worker.module.ts).
// The shared BullMQ connection is registered globally by VocabulariesModule.
@Module({
  imports: [
    TypeOrmModule.forFeature([ProductionAttempt, Vocabulary]),
    BullModule.registerQueue({ name: PRACTICE_SCORING_QUEUE }),
  ],
  controllers: [PracticeController],
  providers: [PracticeService, ScoringQueueProducer],
})
export class PracticeModule {}
