import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MePronunciationController } from '@/pronunciation/me-pronunciation.controller';
import { PronunciationAttempt } from '@/pronunciation/entities/pronunciation-attempt.entity';
import { PronunciationService } from '@/pronunciation/pronunciation.service';

@Module({
  imports: [TypeOrmModule.forFeature([PronunciationAttempt])],
  controllers: [MePronunciationController],
  providers: [PronunciationService],
})
export class PronunciationModule {}
