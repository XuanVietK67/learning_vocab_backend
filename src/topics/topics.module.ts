import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Topic } from '@/topics/entities/topic.entity';
import { VocabularyTopic } from '@/topics/entities/vocabulary-topic.entity';
import { TopicsController } from '@/topics/topics.controller';
import { TopicsService } from '@/topics/topics.service';

@Module({
  imports: [TypeOrmModule.forFeature([Topic, VocabularyTopic])],
  controllers: [TopicsController],
  providers: [TopicsService],
  exports: [TopicsService],
})
export class TopicsModule {}
