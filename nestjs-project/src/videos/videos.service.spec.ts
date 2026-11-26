import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
import { ChannelsService } from '../channels/channels.service';
import { StorageService } from '../storage/storage.service';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosService, defaultTitle, partCountFor } from './videos.service';
import {
  InvalidPartNumberException,
  VideoNotFoundException,
  VideoNotUploadableException,
} from './videos.exceptions';

const USER_ID = 'user-1';
const CHANNEL = { id: 'channel-1', user_id: USER_ID };

function uniqueViolation(column: string): QueryFailedError {
  return new QueryFailedError('INSERT', [], {
    code: '23505',
    detail: `Key (${column})=(x) already exists.`,
  } as unknown as Error);
}

function makeVideo(overrides: Partial<Video> = {}): Video {
  return Object.assign(new Video(), {
    id: 'video-1',
    channel_id: CHANNEL.id,
    public_id: 'AAAAAAAAAAA',
    title: 'aula',
    original_filename: 'aula.mp4',
    content_type: 'video/mp4',
    size_bytes: 1024,
    status: VideoStatus.Draft,
    upload_id: 'upload-1',
    video_key: 'video-1/original',
    thumbnail_key: null,
    duration_seconds: null,
    metadata: null,
    failure_reason: null,
    processed_at: null,
    ...overrides,
  });
}

describe('VideosService', () => {
  let service: VideosService;
  const videoRepository = {
    create: jest.fn((data: Partial<Video>) => Object.assign(new Video(), data)),
    save: jest.fn(),
    findOne: jest.fn(),
  };
  const channelsService = { findByUserId: jest.fn() };
  const storageService = {
    createMultipartUpload: jest.fn(),
    presignUploadPart: jest.fn(),
    listParts: jest.fn(),
    completeMultipartUpload: jest.fn(),
    presignPublicGet: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    videoRepository.create.mockImplementation((data: Partial<Video>) =>
      Object.assign(new Video(), data),
    );
    videoRepository.save.mockImplementation((v: Video) => Promise.resolve(v));
    channelsService.findByUserId.mockResolvedValue(CHANNEL);
    storageService.createMultipartUpload.mockResolvedValue('upload-1');

    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: getRepositoryToken(Video), useValue: videoRepository },
        { provide: ChannelsService, useValue: channelsService },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();

    service = module.get(VideosService);
  });

  describe('initiateUpload', () => {
    const input = {
      filename: 'aula-1.mp4',
      content_type: 'video/mp4',
      size_bytes: 1048576,
    };

    it('should create a draft under the caller channel with the multipart upload id', async () => {
      const { video, upload } = await service.initiateUpload(USER_ID, input);

      expect(video.status).toBe(VideoStatus.Draft);
      expect(video.channel_id).toBe(CHANNEL.id);
      expect(video.upload_id).toBe('upload-1');
      expect(video.video_key).toBe(`${video.id}/original`);
      expect(video.public_id).toMatch(/^[A-Za-z0-9]{11}$/);
      expect(storageService.createMultipartUpload).toHaveBeenCalledWith(
        video.video_key,
        'video/mp4',
      );
      expect(upload).toEqual({
        part_size_bytes: 67108864,
        part_count: 1,
        max_parts_per_request: 100,
      });
    });

    it('should default the title to the filename without extension', async () => {
      const { video } = await service.initiateUpload(USER_ID, input);

      expect(video.title).toBe('aula-1');
    });

    it('should keep an explicit title', async () => {
      const { video } = await service.initiateUpload(USER_ID, {
        ...input,
        title: 'Minha aula',
      });

      expect(video.title).toBe('Minha aula');
    });

    it('should retry with a new public_id on collision', async () => {
      videoRepository.save
        .mockRejectedValueOnce(uniqueViolation('public_id'))
        .mockImplementationOnce((v: Video) => Promise.resolve(v));

      const { video } = await service.initiateUpload(USER_ID, input);

      expect(videoRepository.save).toHaveBeenCalledTimes(2);
      expect(video.public_id).toMatch(/^[A-Za-z0-9]{11}$/);
    });

    it('should give up after 5 public_id collisions', async () => {
      videoRepository.save.mockRejectedValue(uniqueViolation('public_id'));

      await expect(
        service.initiateUpload(USER_ID, input),
      ).rejects.toBeInstanceOf(QueryFailedError);
      expect(videoRepository.save).toHaveBeenCalledTimes(5);
    });

    it('should rethrow a unique violation on another column without retrying', async () => {
      videoRepository.save.mockRejectedValue(uniqueViolation('id'));

      await expect(
        service.initiateUpload(USER_ID, input),
      ).rejects.toBeInstanceOf(QueryFailedError);
      expect(videoRepository.save).toHaveBeenCalledTimes(1);
    });
  });

  describe('partCountFor', () => {
    it.each([
      [1, 1],
      [67108864, 1],
      [67108865, 2],
      [10737418240, 160],
    ])('should split %d bytes into %d parts', (size, parts) => {
      expect(partCountFor(size)).toBe(parts);
    });
  });

  describe('defaultTitle', () => {
    it('should strip the extension and cap at 100 chars', () => {
      expect(defaultTitle('aula-1.mp4')).toBe('aula-1');
      expect(defaultTitle('sem-extensao')).toBe('sem-extensao');
      expect(defaultTitle(`${'a'.repeat(150)}.mp4`)).toHaveLength(100);
    });
  });

  describe('findOwnedVideo', () => {
    it('should return the video when it belongs to the caller channel', async () => {
      const video = makeVideo();
      videoRepository.findOne.mockResolvedValue(video);

      await expect(service.findOwnedVideo(USER_ID, video.id)).resolves.toBe(
        video,
      );
      expect(videoRepository.findOne).toHaveBeenCalledWith({
        where: { id: video.id, channel_id: CHANNEL.id },
      });
    });

    it('should throw VideoNotFoundException when no owned video matches', async () => {
      videoRepository.findOne.mockResolvedValue(null);

      await expect(
        service.findOwnedVideo(USER_ID, 'other'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });

    it('should throw VideoNotFoundException when the user has no channel', async () => {
      channelsService.findByUserId.mockResolvedValue(null);

      await expect(
        service.findOwnedVideo(USER_ID, 'video-1'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });
  });

  describe('signUploadParts', () => {
    it('should sign each requested part with the video key and upload id', async () => {
      videoRepository.findOne.mockResolvedValue(
        makeVideo({ size_bytes: 3 * 64 * 1024 ** 2 }),
      );
      storageService.presignUploadPart.mockImplementation(
        (_key: string, _uploadId: string, n: number) =>
          Promise.resolve(`http://storage/part-${n}`),
      );

      const result = await service.signUploadParts(USER_ID, 'video-1', [1, 3]);

      expect(result.parts).toEqual([
        { part_number: 1, url: 'http://storage/part-1' },
        { part_number: 3, url: 'http://storage/part-3' },
      ]);
      expect(storageService.presignUploadPart).toHaveBeenCalledWith(
        'video-1/original',
        'upload-1',
        1,
      );
      expect(result.expires_at.getTime()).toBeGreaterThan(
        Date.now() + 3500 * 1000,
      );
    });

    it('should reject a part number above the part count', async () => {
      videoRepository.findOne.mockResolvedValue(makeVideo({ size_bytes: 1 }));

      await expect(
        service.signUploadParts(USER_ID, 'video-1', [2]),
      ).rejects.toBeInstanceOf(InvalidPartNumberException);
      expect(storageService.presignUploadPart).not.toHaveBeenCalled();
    });

    it.each([VideoStatus.Processing, VideoStatus.Ready, VideoStatus.Failed])(
      'should reject a video in %s',
      async (status) => {
        videoRepository.findOne.mockResolvedValue(makeVideo({ status }));

        await expect(
          service.signUploadParts(USER_ID, 'video-1', [1]),
        ).rejects.toBeInstanceOf(VideoNotUploadableException);
      },
    );
  });

  describe('listUploadedParts', () => {
    it('should map the stored parts', async () => {
      videoRepository.findOne.mockResolvedValue(makeVideo());
      storageService.listParts.mockResolvedValue([
        { partNumber: 1, etag: '"a"', size: 10 },
        { partNumber: 2, etag: '"b"', size: 5 },
      ]);

      await expect(
        service.listUploadedParts(USER_ID, 'video-1'),
      ).resolves.toEqual([
        { part_number: 1, etag: '"a"', size_bytes: 10 },
        { part_number: 2, etag: '"b"', size_bytes: 5 },
      ]);
    });

    it('should reject a video that is no longer a draft', async () => {
      videoRepository.findOne.mockResolvedValue(
        makeVideo({ status: VideoStatus.Processing, upload_id: null }),
      );

      await expect(
        service.listUploadedParts(USER_ID, 'video-1'),
      ).rejects.toBeInstanceOf(VideoNotUploadableException);
    });
  });
});
