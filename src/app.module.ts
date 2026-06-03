import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import audioConfig from './config/audio.config';
import authConfig from './config/auth.config';
import databaseConfig from './config/database.config';
import learnConfig from './config/learn.config';
import mailConfig from './config/mail.config';
import pronunciationConfig from './config/pronunciation.config';
import redisConfig from './config/redis.config';
import { AuthModule } from './auth/auth.module';
import { DecksModule } from './decks/decks.module';
import { LearnModule } from './learn/learn.module';
import { MailerModule } from './mailer/mailer.module';
import { ProgressModule } from './progress/progress.module';
import { PronunciationModule } from './pronunciation/pronunciation.module';
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
        pronunciationConfig,
      ],
      envFilePath: ['.env'],
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.get<number>('pronunciation.rateTtlSeconds', 60) * 1000,
          limit: config.get<number>('pronunciation.rateLimit', 20),
        },
      ],
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
    MailerModule,
    UsersModule,
    AuthModule,
    VocabulariesModule,
    TopicsModule,
    DecksModule,
    ProgressModule,
    LearnModule,
    PronunciationModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
