import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import audioConfig from './config/audio.config';
import authConfig from './config/auth.config';
import databaseConfig from './config/database.config';
import enrichmentConfig from './config/enrichment.config';
import gemmaConfig from './config/gemma.config';
import groqConfig from './config/groq.config';
import imageConfig from './config/image.config';
import learnConfig from './config/learn.config';
import mailConfig from './config/mail.config';
import pronunciationConfig from './config/pronunciation.config';
import redisConfig from './config/redis.config';
import { AuthModule } from './auth/auth.module';
import { DecksModule } from './decks/decks.module';
import { LeaderboardModule } from './leaderboard/leaderboard.module';
import { LearnModule } from './learn/learn.module';
import { MailerModule } from './mailer/mailer.module';
import { PracticeModule } from './practice/practice.module';
import { ProgressModule } from './progress/progress.module';
import { PronunciationModule } from './pronunciation/pronunciation.module';
import { SpeakingRoomModule } from './speaking-room/speaking-room.module';
import { TopicsModule } from './topics/topics.module';
import { UsersModule } from './users/users.module';
import { VocabulariesModule } from './vocabularies/vocabularies.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        databaseConfig,
        authConfig,
        learnConfig,
        mailConfig,
        redisConfig,
        audioConfig,
        enrichmentConfig,
        gemmaConfig,
        groqConfig,
        imageConfig,
        pronunciationConfig,
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
        ssl:
          process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
        autoLoadEntities: true,
        synchronize: false,
      }),
    }),
    MailerModule,
    UsersModule,
    AuthModule,
    VocabulariesModule,
    TopicsModule,
    DecksModule,
    ProgressModule,
    LearnModule,
    LeaderboardModule,
    PracticeModule,
    PronunciationModule,
    SpeakingRoomModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
