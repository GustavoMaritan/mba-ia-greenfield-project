import { Test } from '@nestjs/testing';
import { Job, UnrecoverableError } from 'bullmq';
import { StorageBucket } from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from '../videos/entities/video.entity';
import type { VideoProcessingJobData } from '../videos/video-processing.producer';
import { VideosService } from '../videos/videos.service';
import { FfmpegService } from './ffmpeg.service';
import { VideoProcessingProcessor } from './video-processing.processor';

const VIDEO_ID = '6a4f3b8e-0000-4000-8000-000000000001';

function makeJob(
  overrides: Partial<{ attemptsMade: number; attempts: number }> = {},
): Job<VideoProcessingJobData> {
  return {
    data: { videoId: VIDEO_ID },
    attemptsMade: overrides.attemptsMade ?? 0,
    opts: { attempts: overrides.attempts ?? 3 },
  } as unknown as Job<VideoProcessingJobData>;
}

describe('VideoProcessingProcessor', () => {
  let processor: VideoProcessingProcessor;
  const videosService = {
    findById: jest.fn(),
    markReady: jest.fn(),
    markFailed: jest.fn(),
  };
  const storageService = {
    presignInternalGet: jest.fn(),
    putObject: jest.fn(),
  };
  const ffmpegService = { probe: jest.fn(), extractThumbnail: jest.fn() };
  const metadata = {
    width: 320,
    height: 240,
    videoCodec: 'h264',
    audioCodec: 'aac',
    formatName: 'mp4',
    bitRate: 1000,
    frameRate: 25,
    sizeBytes: 100,
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    storageService.presignInternalGet.mockResolvedValue('http://minio/signed');
    ffmpegService.probe.mockResolvedValue({ durationSeconds: 10, metadata });
    ffmpegService.extractThumbnail.mockResolvedValue(Buffer.from('jpeg'));

    const module = await Test.createTestingModule({
      providers: [
        VideoProcessingProcessor,
        { provide: VideosService, useValue: videosService },
        { provide: StorageService, useValue: storageService },
        { provide: FfmpegService, useValue: ffmpegService },
      ],
    }).compile();
    processor = module.get(VideoProcessingProcessor);
  });

  function video(status: VideoStatus): Video {
    return Object.assign(new Video(), {
      id: VIDEO_ID,
      status,
      video_key: `${VIDEO_ID}/original`,
    });
  }

  describe('process', () => {
    it('should skip a deleted video without calling ffmpeg', async () => {
      videosService.findById.mockResolvedValue(null);

      await processor.process(makeJob());

      expect(ffmpegService.probe).not.toHaveBeenCalled();
      expect(videosService.markReady).not.toHaveBeenCalled();
    });

    it('should skip a video that is already ready', async () => {
      videosService.findById.mockResolvedValue(video(VideoStatus.Ready));

      await processor.process(makeJob());

      expect(ffmpegService.probe).not.toHaveBeenCalled();
    });

    it('should probe, store the thumbnail and mark the video ready', async () => {
      videosService.findById.mockResolvedValue(video(VideoStatus.Processing));

      await processor.process(makeJob());

      expect(storageService.presignInternalGet).toHaveBeenCalledWith(
        StorageBucket.Videos,
        `${VIDEO_ID}/original`,
      );
      expect(ffmpegService.probe).toHaveBeenCalledWith('http://minio/signed');
      expect(storageService.putObject).toHaveBeenCalledWith(
        StorageBucket.Thumbnails,
        `${VIDEO_ID}/thumbnail.jpg`,
        Buffer.from('jpeg'),
        'image/jpeg',
      );
      expect(videosService.markReady).toHaveBeenCalledWith(VIDEO_ID, {
        durationSeconds: 10,
        metadata,
        thumbnailKey: `${VIDEO_ID}/thumbnail.jpg`,
      });
    });

    it.each([
      [10, 1],
      [1, 0.5],
    ])(
      'should seek min(1, duration/2) for a %ds video',
      async (duration, seek) => {
        videosService.findById.mockResolvedValue(video(VideoStatus.Processing));
        ffmpegService.probe.mockResolvedValue({
          durationSeconds: duration,
          metadata,
        });

        await processor.process(makeJob());

        expect(ffmpegService.extractThumbnail).toHaveBeenCalledWith(
          'http://minio/signed',
          seek,
        );
      },
    );
  });

  describe('onFailed', () => {
    it('should keep processing on an intermediate failure', async () => {
      await processor.onFailed(makeJob({ attemptsMade: 1 }), new Error('io'));

      expect(videosService.markFailed).not.toHaveBeenCalled();
    });

    it('should mark the video failed on the last attempt', async () => {
      await processor.onFailed(makeJob({ attemptsMade: 3 }), new Error('io'));

      expect(videosService.markFailed).toHaveBeenCalledWith(VIDEO_ID, 'io');
    });

    it('should mark the video failed right away on UnrecoverableError', async () => {
      await processor.onFailed(
        makeJob({ attemptsMade: 1 }),
        new UnrecoverableError('Input has no video stream'),
      );

      expect(videosService.markFailed).toHaveBeenCalledWith(
        VIDEO_ID,
        'Input has no video stream',
      );
    });

    it('should not throw when marking the failure fails', async () => {
      videosService.markFailed.mockRejectedValue(new Error('db down'));

      await expect(
        processor.onFailed(makeJob({ attemptsMade: 3 }), new Error('io')),
      ).resolves.toBeUndefined();
    });
  });
});
