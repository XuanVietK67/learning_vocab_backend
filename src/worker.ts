import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Audio worker entrypoint. Runs as a separate process from the HTTP API
 * (npm run start:worker) and consumes the vocab-audio BullMQ queue. No HTTP
 * server is started — the @Processor begins consuming once the context is up.
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  Logger.log('audio worker started', 'Worker');
}
void bootstrap();
