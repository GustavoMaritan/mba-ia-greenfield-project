import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import { createTestDataSource } from '../test/create-test-data-source';
import { ALL_ENTITIES } from '../test/videos-test-module';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessingModule } from './video-processing.module';
import { VideoProcessingProcessor } from './video-processing.processor';

describe('VideoProcessingModule', () => {
  it('should compile with VideosModule, StorageModule and BullModule.registerQueue', async () => {
    // compile() sem init(): o Worker do BullMQ não chega a subir
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [storageConfig, queueConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        BullModule.forRoot({ connection: { host: 'redis', port: 6379 } }),
        VideoProcessingModule,
      ],
    }).compile();

    expect(module.get(VideoProcessingProcessor)).toBeInstanceOf(
      VideoProcessingProcessor,
    );
    expect(module.get(FfmpegService)).toBeInstanceOf(FfmpegService);
    await module.close();
  });
});
