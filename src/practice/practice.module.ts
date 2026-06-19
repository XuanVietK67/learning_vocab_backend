import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LearnModule } from '@/learn/learn.module';
import { ProductionAttempt } from '@/practice/entities/production-attempt.entity';
import { PracticeController } from '@/practice/practice.controller';
import { PracticeService } from '@/practice/practice.service';
import { PRACTICE_SCORING_QUEUE } from '@/practice/scoring-queue.constants';
import { ScoringQueueProducer } from '@/practice/scoring-queue.producer';
import { User } from '@/users/entities/user.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

// API-side module: the producer + HTTP surface. The scoring consumer
// (ScoringProcessor) runs in the separate worker process (worker.module.ts).
// The shared BullMQ connection is registered globally by VocabulariesModule.
// LearnModule is imported for its exported VocabPickerService (used to suggest
// words to practise).
@Module({
  imports: [
    TypeOrmModule.forFeature([ProductionAttempt, Vocabulary, User]),
    BullModule.registerQueue({ name: PRACTICE_SCORING_QUEUE }),
    LearnModule,
  ],
  controllers: [PracticeController],
  providers: [PracticeService, ScoringQueueProducer],
})
export class PracticeModule {}
