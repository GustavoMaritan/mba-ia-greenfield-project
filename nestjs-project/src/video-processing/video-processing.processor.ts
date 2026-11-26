import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job, UnrecoverableError } from 'bullmq';
import { StorageBucket } from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import { VideoStatus } from '../videos/entities/video.entity';
import type { VideoProcessingJobData } from '../videos/video-processing.producer';
import { VIDEO_KEYS, VIDEO_PROCESSING_QUEUE } from '../videos/videos.constants';
import { VideosService } from '../videos/videos.service';
import { FfmpegService } from './ffmpeg.service';

export const THUMBNAIL_MAX_SEEK_SECONDS = 1;

@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: 2 })
export class VideoProcessingProcessor extends WorkerHost {
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    private readonly videosService: VideosService,
    private readonly storageService: StorageService,
    private readonly ffmpegService: FfmpegService,
  ) {
    super();
  }

  async process(job: Job<VideoProcessingJobData>): Promise<void> {
    const { videoId } = job.data;
    const video = await this.videosService.findById(videoId);

    if (!video) {
      this.logger.warn(`Video ${videoId} no longer exists, skipping job`);
      return;
    }
    if (video.status === VideoStatus.Ready) return;

    // ffprobe/ffmpeg leem o original por range requests via URL interna
    const source = await this.storageService.presignInternalGet(
      StorageBucket.Videos,
      video.video_key,
    );
    const { durationSeconds, metadata } =
      await this.ffmpegService.probe(source);
    const thumbnail = await this.ffmpegService.extractThumbnail(
      source,
      Math.min(THUMBNAIL_MAX_SEEK_SECONDS, durationSeconds / 2),
    );

    const thumbnailKey = VIDEO_KEYS.thumbnail(videoId);
    await this.storageService.putObject(
      StorageBucket.Thumbnails,
      thumbnailKey,
      thumbnail,
      'image/jpeg',
    );
    await this.videosService.markReady(videoId, {
      durationSeconds,
      metadata,
      thumbnailKey,
    });
    this.logger.log(`Video ${videoId} ready (${durationSeconds}s)`);
  }

  // o evento chega depois do attemptsMade ser incrementado pelo bullmq
  @OnWorkerEvent('failed')
  async onFailed(
    job: Job<VideoProcessingJobData> | undefined,
    error: Error,
  ): Promise<void> {
    if (!job) return;
    const isFinal =
      error instanceof UnrecoverableError ||
      error.name === 'UnrecoverableError' ||
      job.attemptsMade >= (job.opts.attempts ?? 1);

    if (!isFinal) {
      this.logger.warn(
        `Video ${job.data.videoId} attempt ${job.attemptsMade} failed: ${error.message}`,
      );
      return;
    }

    try {
      await this.videosService.markFailed(job.data.videoId, error.message);
      this.logger.error(`Video ${job.data.videoId} failed: ${error.message}`);
    } catch (err) {
      // handler de evento: relançar derrubaria o worker
      this.logger.error(
        `Could not mark video ${job.data.videoId} as failed`,
        err instanceof Error ? err.stack : String(err),
      );
    }
  }
}
