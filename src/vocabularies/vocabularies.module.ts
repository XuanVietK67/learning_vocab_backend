import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Topic } from '@/topics/entities/topic.entity';
import { VocabularyTopic } from '@/topics/entities/vocabulary-topic.entity';
import { AUDIO_QUEUE } from '@/vocabularies/audio/audio-queue.constants';
import { AudioQueueProducer } from '@/vocabularies/audio/audio-queue.producer';
import { VocabularyExample } from '@/vocabularies/entities/vocabulary-example.entity';
import { VocabularySense } from '@/vocabularies/entities/vocabulary-sense.entity';
import { VocabularyTranslation } from '@/vocabularies/entities/vocabulary-translation.entity';
import { Vocabulary } from '@/vocabularies/entities/vocabulary.entity';
import { AdminVocabulariesController } from '@/vocabularies/admin-vocabularies.controller';
import { AdminVocabularyExamplesController } from '@/vocabularies/admin-vocabulary-examples.controller';
import { AdminVocabularySensesController } from '@/vocabularies/admin-vocabulary-senses.controller';
import { AdminVocabularyTopicsController } from '@/vocabularies/admin-vocabulary-topics.controller';
import { AdminVocabularyTranslationsController } from '@/vocabularies/admin-vocabulary-translations.controller';
import { MeVocabulariesController } from '@/vocabularies/me-vocabularies.controller';
import { VocabulariesController } from '@/vocabularies/vocabularies.controller';
import { VocabulariesService } from '@/vocabularies/vocabularies.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Vocabulary,
      VocabularySense,
      VocabularyTranslation,
      VocabularyExample,
      Topic,
      VocabularyTopic,
    ]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string>('redis.password'),
        },
      }),
    }),
    BullModule.registerQueue({ name: AUDIO_QUEUE }),
  ],
  controllers: [
    VocabulariesController,
    MeVocabulariesController,
    AdminVocabulariesController,
    AdminVocabularySensesController,
    AdminVocabularyTranslationsController,
    AdminVocabularyExamplesController,
    AdminVocabularyTopicsController,
  ],
  providers: [VocabulariesService, AudioQueueProducer],
  exports: [VocabulariesService],
})
export class VocabulariesModule {}
