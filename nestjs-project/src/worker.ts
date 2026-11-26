import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { VIDEO_PROCESSING_QUEUE } from './videos/videos.constants';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  // fecha o Worker do BullMQ no SIGTERM (docker compose stop)
  app.enableShutdownHooks();
  new Logger('VideoWorker').log(
    `Video worker ready (queue: ${VIDEO_PROCESSING_QUEUE})`,
  );
}
void bootstrap();
