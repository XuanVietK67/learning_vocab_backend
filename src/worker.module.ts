import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import audioConfig from './config/audio.config';
import databaseConfig from './config/database.config';
import redisConfig from './config/redis.config';
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
      load: [databaseConfig, redisConfig, audioConfig],
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
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    TypeOrmModule.forFeature([Vocabulary]),
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
  providers: [AudioProcessor],
})
export class WorkerModule {}
