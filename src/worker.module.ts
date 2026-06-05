import { join } from 'path';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import audioConfig from './config/audio.config';
import databaseConfig from './config/database.config';
import gemmaConfig from './config/gemma.config';
import redisConfig from './config/redis.config';
import { ProductionAttempt } from './practice/entities/production-attempt.entity';
import { PRACTICE_SCORING_QUEUE } from './practice/scoring-queue.constants';
import { ScoringProcessor } from './practice/scoring.processor';
import { AUDIO_QUEUE } from './vocabularies/audio/audio-queue.constants';
import { AudioProcessor } from './vocabularies/audio/audio.processor';
import { Vocabulary } from './vocabularies/entities/vocabulary.entity';

/**
 * Standalone module for the audio worker process (see worker.ts). It is a pure
 * queue CONSUMER: no HTTP controllers, no producer — just the Redis connection,
 * a DB connection for the Vocabulary repo, and the AudioProcessor.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [databaseConfig, redisConfig, audioConfig, gemmaConfig],
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
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Vocabulary, ProductionAttempt]),
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
  ],
  providers: [AudioProcessor, ScoringProcessor],
})
export class WorkerModule {}
