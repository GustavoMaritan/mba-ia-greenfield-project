import { TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { StorageService } from '../storage/storage.service';
import { cleanAllTables } from '../test/create-test-data-source';
import {
  createUserWithChannel,
  createVideosTestingModule,
} from '../test/videos-test-module';
import { Video, VideoStatus } from './entities/video.entity';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';
import { VideoNotFoundException } from './videos.exceptions';

describe('VideosService (integration)', () => {
  const originalEnv = { ...process.env };
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideosService;
  let storage: StorageService;

  beforeAll(async () => {
    module = await createVideosTestingModule([VideosModule]);
    dataSource = module.get(DataSource);
    service = module.get(VideosService);
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    await module.close();
    process.env = originalEnv;
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  const input = {
    filename: 'aula-1.mp4',
    content_type: 'video/mp4',
    size_bytes: 1024,
  };

  describe('initiateUpload', () => {
    it('should persist a draft with an upload id accepted by the storage', async () => {
      const { user, channel } = await createUserWithChannel(dataSource);

      const { video } = await service.initiateUpload(user.id, input);

      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.Draft);
      expect(row.channel_id).toBe(channel.id);
      expect(row.video_key).toBe(`${video.id}/original`);
      expect(row.public_id).toMatch(/^[A-Za-z0-9]{11}$/);
      await expect(
        storage.listParts(row.video_key, row.upload_id!),
      ).resolves.toEqual([]);
    });

    it('should give different ids and public ids to consecutive uploads', async () => {
      const { user } = await createUserWithChannel(dataSource);

      const first = await service.initiateUpload(user.id, input);
      const second = await service.initiateUpload(user.id, input);

      expect(first.video.id).not.toBe(second.video.id);
      expect(first.video.public_id).not.toBe(second.video.public_id);
    });
  });

  describe('findOwnedVideo', () => {
    it('should return the owner video', async () => {
      const { user } = await createUserWithChannel(dataSource);
      const { video } = await service.initiateUpload(user.id, input);

      const found = await service.findOwnedVideo(user.id, video.id);

      expect(found.id).toBe(video.id);
    });

    it('should hide a video from another channel', async () => {
      const owner = await createUserWithChannel(dataSource);
      const stranger = await createUserWithChannel(dataSource);
      const { video } = await service.initiateUpload(owner.user.id, input);

      await expect(
        service.findOwnedVideo(stranger.user.id, video.id),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });
  });

  describe('signUploadParts / listUploadedParts', () => {
    it('should sign a URL that accepts a real PUT and then list the part', async () => {
      const { user } = await createUserWithChannel(dataSource);
      const { video } = await service.initiateUpload(user.id, input);
      const body = Buffer.alloc(input.size_bytes, 7);

      await expect(
        service.listUploadedParts(user.id, video.id),
      ).resolves.toEqual([]);
      const { parts } = await service.signUploadParts(user.id, video.id, [1]);
      const put = await fetch(parts[0].url, { method: 'PUT', body });
      expect(put.status).toBe(200);

      const uploaded = await service.listUploadedParts(user.id, video.id);
      expect(uploaded).toEqual([
        {
          part_number: 1,
          etag: put.headers.get('etag'),
          size_bytes: input.size_bytes,
        },
      ]);
    });
  });
});
