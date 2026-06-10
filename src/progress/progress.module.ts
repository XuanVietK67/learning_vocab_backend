import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  MeActivityController,
  MeProgressController,
  MeStatsController,
} from '@/progress/progress.controller';
import { ProgressService } from '@/progress/progress.service';
import { LearningActivity } from '@/progress/entities/learning-activity.entity';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { User } from '@/users/entities/user.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserWordProgress,
      LearningActivity,
      User,
      Vocabulary,
    ]),
  ],
  controllers: [MeProgressController, MeStatsController, MeActivityController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
