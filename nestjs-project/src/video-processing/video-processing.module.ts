import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { VIDEO_PROCESSING_QUEUE } from '../videos/videos.constants';
import { VideosModule } from '../videos/videos.module';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessingProcessor } from './video-processing.processor';

// só o worker importa este módulo; a API nunca consome a fila
@Module({
  imports: [
    BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE }),
    VideosModule,
    StorageModule,
  ],
  providers: [FfmpegService, VideoProcessingProcessor],
})
export class VideoProcessingModule {}
