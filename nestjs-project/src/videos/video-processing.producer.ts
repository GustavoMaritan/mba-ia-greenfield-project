import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  VIDEO_PROCESSING_JOB,
  VIDEO_PROCESSING_JOB_OPTIONS,
  VIDEO_PROCESSING_QUEUE,
} from './videos.constants';

export interface VideoProcessingJobData {
  videoId: string;
}

@Injectable()
export class VideoProcessingProducer {
  constructor(
    @InjectQueue(VIDEO_PROCESSING_QUEUE)
    private readonly queue: Queue<VideoProcessingJobData>,
  ) {}

  // jobId = videoId: chamadas repetidas não duplicam o job
  async enqueue(videoId: string): Promise<void> {
    await this.queue.add(
      VIDEO_PROCESSING_JOB,
      { videoId },
      {
        jobId: videoId,
        attempts: VIDEO_PROCESSING_JOB_OPTIONS.attempts,
        backoff: { ...VIDEO_PROCESSING_JOB_OPTIONS.backoff },
      },
    );
  }
}
