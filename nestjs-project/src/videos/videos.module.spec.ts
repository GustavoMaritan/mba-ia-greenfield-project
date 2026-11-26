import { BullModule, getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { createTestDataSource } from '../test/create-test-data-source';
import { ALL_ENTITIES } from '../test/videos-test-module';
import { VideosModule } from './videos.module';
import { VideoProcessingProducer } from './video-processing.producer';
import { VIDEO_PROCESSING_QUEUE } from './videos.constants';
import { VideosService } from './videos.service';

describe('VideosModule', () => {
  it('should compile with TypeOrmModule.forFeature, BullModule.registerQueue, ChannelsModule and StorageModule', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        BullModule.forRoot({ connection: { host: 'redis', port: 6379 } }),
        VideosModule,
      ],
    }).compile();

    expect(module.get(VideosService)).toBeInstanceOf(VideosService);
    expect(module.get(VideoProcessingProducer)).toBeInstanceOf(
      VideoProcessingProducer,
    );
    expect(module.get(getQueueToken(VIDEO_PROCESSING_QUEUE))).toBeDefined();
    await module.close();
  });
});
