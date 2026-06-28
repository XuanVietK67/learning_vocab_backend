import { join } from 'path';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import audioConfig from './config/audio.config';
import databaseConfig from './config/database.config';
import enrichmentConfig from './config/enrichment.config';
import gemmaConfig from './config/gemma.config';
import imageConfig from './config/image.config';
import redisConfig from './config/redis.config';
import { ProductionAttempt } from './practice/entities/production-attempt.entity';
import { PRACTICE_SCORING_QUEUE } from './practice/scoring-queue.constants';
import { ScoringProcessor } from './practice/scoring.processor';
import { AUDIO_QUEUE } from './vocabularies/audio/audio-queue.constants';
import { AudioQueueProducer } from './vocabularies/audio/audio-queue.producer';
import { AudioProcessor } from './vocabularies/audio/audio.processor';
import { EnrichmentCacheService } from './vocabularies/enrichment/enrichment-cache.service';
import { ENRICHMENT_QUEUE } from './vocabularies/enrichment/enrichment-queue.constants';
import { EnrichmentProcessor } from './vocabularies/enrichment/enrichment.processor';
import { CefrEstimatorService } from './vocabularies/enrichment/sources/cefr-estimator.service';
import { EspeakG2pService } from './vocabularies/enrichment/sources/espeak-g2p.service';
import { ExampleRetrievalService } from './vocabularies/enrichment/sources/example-retrieval.service';
import { TranslationService } from './vocabularies/enrichment/sources/translation.service';
import { WiktionaryDictionaryProvider } from './vocabularies/enrichment/sources/wiktionary-dictionary.provider';
import { BilingualLexiconEntry } from './vocabularies/entities/bilingual-lexicon.entity';
import { CefrLexiconEntry } from './vocabularies/entities/cefr-lexicon.entity';
import { CorpusSentence } from './vocabularies/entities/corpus-sentence.entity';
import { DictionaryEntry } from './vocabularies/entities/dictionary-entry.entity';
import { VocabEnrichmentCache } from './vocabularies/entities/vocab-enrichment-cache.entity';
import { VocabEnrichmentJob } from './vocabularies/entities/vocab-enrichment-job.entity';
import { VocabularySense } from './vocabularies/entities/vocabulary-sense.entity';
import { Vocabulary } from './vocabularies/entities/vocabulary.entity';
import { IMAGE_QUEUE } from './vocabularies/images/image-queue.constants';
import { ImageProcessor } from './vocabularies/images/image.processor';
import { VocabularyPersistenceService } from './vocabularies/vocabulary-persistence.service';
import { DeckMembershipService } from './decks/deck-membership.service';

/**
 * Standalone module for the audio worker process (see worker.ts). It is a pure
 * queue CONSUMER: no HTTP controllers, no producer — just the Redis connection,
 * a DB connection for the Vocabulary repo, and the AudioProcessor.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        redisConfig,
        audioConfig,
        enrichmentConfig,
        gemmaConfig,
        imageConfig,
      ],
      envFilePath: ['.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        username: config.get<string>('database.username'),
        password: config.get<string>('database.password'),
        database: config.get<string>('database.name'),
        // The worker imports no feature modules, so autoLoadEntities would only
        // see Vocabulary and fail to resolve its relations (User, VocabularySense,
        // VocabularyTopic, ...). Load the full entity graph by glob instead, the
        // same way data-source.ts does. __dirname resolves to src/ under ts-node
        // and dist/ when compiled, so the {ts,js} extensions cover both.
        entities: [join(__dirname, '**', '*.entity.{ts,js}')],
        ssl:
          process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([
      Vocabulary,
      VocabularySense,
      VocabEnrichmentJob,
      VocabEnrichmentCache,
      CefrLexiconEntry,
      CorpusSentence,
      BilingualLexiconEntry,
      DictionaryEntry,
      ProductionAttempt,
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
    BullModule.registerQueue({ name: PRACTICE_SCORING_QUEUE }),
    BullModule.registerQueue({ name: ENRICHMENT_QUEUE }),
    BullModule.registerQueue({ name: IMAGE_QUEUE }),
  ],
  providers: [
    AudioProcessor,
    ScoringProcessor,
    EnrichmentProcessor,
    ImageProcessor,
    EnrichmentCacheService,
    CefrEstimatorService,
    ExampleRetrievalService,
    TranslationService,
    WiktionaryDictionaryProvider,
    EspeakG2pService,
    VocabularyPersistenceService,
    // The enrichment worker enqueues audio for auto-approved user words and
    // appends bulk-imported words to their target deck.
    AudioQueueProducer,
    DeckMembershipService,
  ],
})
export class WorkerModule {}
