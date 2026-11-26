import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TestingModule } from '@nestjs/testing';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Job, UnrecoverableError } from 'bullmq';
import { DataSource } from 'typeorm';
import {
  S3_INTERNAL_CLIENT,
  StorageBucket,
} from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import {
  createUserWithChannel,
  createVideosTestingModule,
} from '../test/videos-test-module';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import type { VideoProcessingJobData } from '../videos/video-processing.producer';
import { VideosModule } from '../videos/videos.module';
import { VideosService } from '../videos/videos.service';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessingProcessor } from './video-processing.processor';

const SAMPLE = join(__dirname, '..', '..', 'test', 'fixtures', 'sample.mp4');

describe('VideoProcessingProcessor (integration)', () => {
  const originalEnv = { ...process.env };
  let module: TestingModule;
  let dataSource: DataSource;
  let storage: StorageService;
  let s3: S3Client;
  let processor: VideoProcessingProcessor;

  beforeAll(async () => {
    // sem VideoProcessingModule: o processor é montado à mão para não subir
    // um Worker do BullMQ dentro do teste
    module = await createVideosTestingModule([VideosModule]);
    dataSource = module.get(DataSource);
    storage = module.get(StorageService);
    s3 = module.get(S3_INTERNAL_CLIENT);
    processor = new VideoProcessingProcessor(
      module.get(VideosService),
      storage,
      new FfmpegService(),
    );
  });

  afterAll(async () => {
    await module.close();
    process.env = originalEnv;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function processingVideo(original: Buffer): Promise<Video> {
    const { channel } = await createUserWithChannel(dataSource);
    const repo = dataSource.getRepository(Video);
    const video = await repo.save(
      repo.create({
        channel_id: channel.id,
        public_id: Math.random().toString(36).slice(2, 13).padEnd(11, 'x'),
        title: 'sample',
        original_filename: 'sample.mp4',
        content_type: 'video/mp4',
        size_bytes: original.length,
        status: VideoStatus.Processing,
        video_key: 'pending',
      }),
    );
    video.video_key = `${video.id}/original`;
    await repo.save(video);
    await storage.putObject(
      StorageBucket.Videos,
      video.video_key,
      original,
      'video/mp4',
    );
    return video;
  }

  function job(videoId: string, attemptsMade = 0) {
    return {
      data: { videoId },
      attemptsMade,
      opts: { attempts: 3 },
    } as unknown as Job<VideoProcessingJobData>;
  }

  it('should leave the video ready with metadata and a JPEG thumbnail', async () => {
    const video = await processingVideo(readFileSync(SAMPLE));

    await processor.process(job(video.id));

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(row.status).toBe(VideoStatus.Ready);
    expect(row.duration_seconds).toBeCloseTo(3, 0);
    expect(row.metadata?.width).toBe(320);
    expect(row.processed_at).toBeInstanceOf(Date);
    expect(row.thumbnail_key).toBe(`${video.id}/thumbnail.jpg`);

    const thumb = await s3.send(
      new GetObjectCommand({
        Bucket: storage.bucketName(StorageBucket.Thumbnails),
        Key: row.thumbnail_key!,
      }),
    );
    expect(thumb.ContentType).toBe('image/jpeg');
  });

  it('should not touch a video that is already ready', async () => {
    const video = await processingVideo(readFileSync(SAMPLE));
    await processor.process(job(video.id));
    const first = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });

    await processor.process(job(video.id));

    const second = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(second.processed_at).toEqual(first.processed_at);
  });

  it('should finish quietly when the video was deleted', async () => {
    await expect(
      processor.process(job('5f8b2c1e-0000-4000-8000-000000000000')),
    ).resolves.toBeUndefined();
  });

  it('should mark a non-video original as failed without retrying', async () => {
    const video = await processingVideo(Buffer.from('not a video at all'));

    const error = await processor.process(job(video.id)).catch((e) => e);
    expect(error).toBeInstanceOf(UnrecoverableError);
    await processor.onFailed(job(video.id, 1), error as Error);

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(row.status).toBe(VideoStatus.Failed);
    expect(row.failure_reason).toBeTruthy();
  });

  it('should keep processing after a transient failure and fail on the 3rd attempt', async () => {
    const video = await processingVideo(readFileSync(SAMPLE));
    const transient = new Error('connection reset');

    await processor.onFailed(job(video.id, 1), transient);
    const afterFirst = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(afterFirst.status).toBe(VideoStatus.Processing);

    await processor.onFailed(job(video.id, 3), transient);
    const afterLast = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(afterLast.status).toBe(VideoStatus.Failed);
    expect(afterLast.failure_reason).toBe('connection reset');
  });

  it('should truncate long failure reasons to 500 chars', async () => {
    const video = await processingVideo(readFileSync(SAMPLE));

    await module.get(VideosService).markFailed(video.id, 'x'.repeat(800));

    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: video.id });
    expect(row.failure_reason).toHaveLength(500);
  });
});
