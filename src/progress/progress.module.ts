import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  MeProgressController,
  MeStatsController,
} from '@/progress/progress.controller';
import { ProgressService } from '@/progress/progress.service';
import { UserWordProgress } from '@/progress/entities/user-word-progress.entity';
import { User } from '@/users/entities/user.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserWordProgress, User, Vocabulary])],
  controllers: [MeProgressController, MeStatsController],
  providers: [ProgressService],
  exports: [ProgressService],
})
export class ProgressModule {}
