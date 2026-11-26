import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { Video, VideoStatus } from '../src/videos/entities/video.entity';
import {
  AuthenticatedUser,
  createAuthenticatedUser,
} from './helpers/authenticated-user';
import { createE2eApp } from './helpers/create-e2e-app';

const TEN_GIB = 10 * 1024 ** 3;

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: AuthenticatedUser;
  let stranger: AuthenticatedUser;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    owner = await createAuthenticatedUser(app);
    stranger = await createAuthenticatedUser(app);
  });

  const validBody = {
    filename: 'aula.mp4',
    content_type: 'video/mp4',
    size_bytes: 1048576,
  };

  function initiate(user: AuthenticatedUser, body: object = validBody) {
    return request(app.getHttpServer())
      .post('/channels/me/videos')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send(body);
  }

  describe('POST /channels/me/videos', () => {
    it('returns 201 with a draft, a public_id and the upload plan', async () => {
      const res = await initiate(owner).expect(201);

      expect(res.body).toMatchObject({
        status: 'draft',
        title: 'aula',
        original_filename: 'aula.mp4',
        content_type: 'video/mp4',
        size_bytes: 1048576,
        duration_seconds: null,
        metadata: null,
        upload: {
          part_size_bytes: 67108864,
          part_count: 1,
          max_parts_per_request: 100,
        },
      });
      expect(res.body.public_id).toMatch(/^[A-Za-z0-9]{11}$/);
    });

    it('accepts exactly 10 GiB and plans 160 parts', async () => {
      const res = await initiate(owner, {
        ...validBody,
        size_bytes: TEN_GIB,
      }).expect(201);

      expect(res.body.upload.part_count).toBe(160);
    });

    it('returns 400 when size_bytes is above 10 GiB', async () => {
      const res = await initiate(owner, {
        ...validBody,
        size_bytes: TEN_GIB + 1,
      }).expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for a non-video content_type', async () => {
      const res = await initiate(owner, {
        ...validBody,
        content_type: 'image/png',
      }).expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 400 for an unknown field', async () => {
      const res = await initiate(owner, {
        ...validBody,
        channel_id: randomUUID(),
      }).expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer())
        .post('/channels/me/videos')
        .send(validBody)
        .expect(401);
    });
  });

  describe('GET /channels/me/videos/:id', () => {
    it('returns 200 with the draft to its owner', async () => {
      const created = await initiate(owner).expect(201);

      const res = await request(app.getHttpServer())
        .get(`/channels/me/videos/${created.body.id}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(200);

      expect(res.body).toMatchObject({
        id: created.body.id,
        status: 'draft',
        duration_seconds: null,
        metadata: null,
        failure_reason: null,
        processed_at: null,
      });
      expect(res.body.upload).toBeUndefined();
    });

    it('returns 404 for another user video, same as a missing id', async () => {
      const created = await initiate(owner).expect(201);

      const foreign = await request(app.getHttpServer())
        .get(`/channels/me/videos/${created.body.id}`)
        .set('Authorization', `Bearer ${stranger.accessToken}`)
        .expect(404);
      const missing = await request(app.getHttpServer())
        .get(`/channels/me/videos/${randomUUID()}`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(404);

      expect(foreign.body).toEqual(missing.body);
      expect(foreign.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 400 for a non-uuid id', async () => {
      const res = await request(app.getHttpServer())
        .get('/channels/me/videos/not-a-uuid')
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer())
        .get(`/channels/me/videos/${randomUUID()}`)
        .expect(401);
    });
  });

  describe('upload parts', () => {
    function signParts(
      user: AuthenticatedUser,
      id: string,
      partNumbers: unknown,
    ) {
      return request(app.getHttpServer())
        .post(`/channels/me/videos/${id}/upload-parts`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ part_numbers: partNumbers });
    }

    function listParts(user: AuthenticatedUser, id: string) {
      return request(app.getHttpServer())
        .get(`/channels/me/videos/${id}/upload-parts`)
        .set('Authorization', `Bearer ${user.accessToken}`);
    }

    it('signs part 1, accepts a direct PUT to storage and lists it for resume', async () => {
      const body = Buffer.alloc(2048, 1);
      const created = await initiate(owner, {
        ...validBody,
        size_bytes: body.length,
      }).expect(201);
      const id: string = created.body.id;

      const before = await listParts(owner, id).expect(200);
      expect(before.body).toEqual({ parts: [] });

      const signed = await signParts(owner, id, [1]).expect(200);
      expect(signed.body.parts).toHaveLength(1);
      expect(signed.body.parts[0].part_number).toBe(1);
      expect(signed.body.parts[0].url).toContain('X-Amz-Expires=3600');
      const expiresIn = Date.parse(signed.body.expires_at) - Date.now();
      expect(expiresIn).toBeGreaterThan(3500 * 1000);

      // o corpo vai direto para o storage, nunca pela API
      const put = await fetch(signed.body.parts[0].url, {
        method: 'PUT',
        body,
      });
      expect(put.status).toBe(200);

      const after = await listParts(owner, id).expect(200);
      expect(after.body.parts).toEqual([
        {
          part_number: 1,
          etag: put.headers.get('etag'),
          size_bytes: body.length,
        },
      ]);
    });

    it.each([
      [[]],
      [[1, 1]],
      [Array.from({ length: 101 }, (_, i) => i + 1)],
      [[0]],
    ])(
      'returns 400 VALIDATION_ERROR for part_numbers %j',
      async (partNumbers) => {
        const created = await initiate(owner).expect(201);

        const res = await signParts(owner, created.body.id, partNumbers).expect(
          400,
        );

        expect(res.body.error).toBe('VALIDATION_ERROR');
      },
    );

    it('returns 400 INVALID_PART_NUMBER above the part count', async () => {
      const created = await initiate(owner).expect(201);

      const res = await signParts(owner, created.body.id, [2]).expect(400);

      expect(res.body.error).toBe('INVALID_PART_NUMBER');
    });

    it('returns 404 for another user video', async () => {
      const created = await initiate(owner).expect(201);

      const sign = await signParts(stranger, created.body.id, [1]).expect(404);
      const list = await listParts(stranger, created.body.id).expect(404);

      expect(sign.body.error).toBe('VIDEO_NOT_FOUND');
      expect(list.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 409 VIDEO_NOT_UPLOADABLE when the video is not a draft', async () => {
      const created = await initiate(owner).expect(201);
      await dataSource
        .getRepository(Video)
        .update(created.body.id, { status: VideoStatus.Processing });

      const sign = await signParts(owner, created.body.id, [1]).expect(409);
      const list = await listParts(owner, created.body.id).expect(409);

      expect(sign.body.error).toBe('VIDEO_NOT_UPLOADABLE');
      expect(list.body.error).toBe('VIDEO_NOT_UPLOADABLE');
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer())
        .post(`/channels/me/videos/${randomUUID()}/upload-parts`)
        .send({ part_numbers: [1] })
        .expect(401);
      await request(app.getHttpServer())
        .get(`/channels/me/videos/${randomUUID()}/upload-parts`)
        .expect(401);
    });
  });

  describe('POST /channels/me/videos/:id/upload-completion', () => {
    function complete(user: AuthenticatedUser, id: string) {
      return request(app.getHttpServer())
        .post(`/channels/me/videos/${id}/upload-completion`)
        .set('Authorization', `Bearer ${user.accessToken}`);
    }

    async function uploadedDraft(user: AuthenticatedUser): Promise<string> {
      const body = Buffer.alloc(4096, 9);
      const created = await initiate(user, {
        ...validBody,
        size_bytes: body.length,
      }).expect(201);
      const signed = await request(app.getHttpServer())
        .post(`/channels/me/videos/${created.body.id}/upload-parts`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ part_numbers: [1] })
        .expect(200);
      await fetch(signed.body.parts[0].url, { method: 'PUT', body });
      return created.body.id;
    }

    it('returns 202 processing after all parts are uploaded, and again when repeated', async () => {
      const id = await uploadedDraft(owner);

      const first = await complete(owner, id).expect(202);
      const second = await complete(owner, id).expect(202);

      expect(first.body).toEqual({
        id,
        public_id: expect.stringMatching(/^[A-Za-z0-9]{11}$/),
        status: 'processing',
      });
      expect(second.body.status).toBe('processing');
    });

    it('returns 409 UPLOAD_INCOMPLETE when no part was uploaded and keeps the draft', async () => {
      const created = await initiate(owner).expect(201);

      const res = await complete(owner, created.body.id).expect(409);

      expect(res.body.error).toBe('UPLOAD_INCOMPLETE');
      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: created.body.id });
      expect(row.status).toBe('draft');
    });

    it.each(['ready', 'failed'] as const)(
      'returns 409 VIDEO_NOT_UPLOADABLE for a %s video',
      async (status) => {
        const created = await initiate(owner).expect(201);
        await dataSource.getRepository(Video).update(created.body.id, {
          status: status as VideoStatus,
          upload_id: null,
        });

        const res = await complete(owner, created.body.id).expect(409);

        expect(res.body.error).toBe('VIDEO_NOT_UPLOADABLE');
      },
    );

    it('returns 404 for another user video', async () => {
      const created = await initiate(owner).expect(201);

      const res = await complete(stranger, created.body.id).expect(404);

      expect(res.body.error).toBe('VIDEO_NOT_FOUND');
    });

    it('returns 401 without a token', async () => {
      await request(app.getHttpServer())
        .post(`/channels/me/videos/${randomUUID()}/upload-completion`)
        .expect(401);
    });
  });

  describe('public routes', () => {
    const routes = ['', '/stream', '/download', '/thumbnail'];

    it.each(['draft', 'processing', 'failed'] as const)(
      'answer 404 VIDEO_NOT_FOUND to anonymous users for a %s video',
      async (status) => {
        const created = await initiate(owner).expect(201);
        await dataSource
          .getRepository(Video)
          .update(created.body.id, { status: status as VideoStatus });

        for (const route of routes) {
          const res = await request(app.getHttpServer())
            .get(`/videos/${created.body.public_id}${route}`)
            .expect(404);
          expect(res.body.error).toBe('VIDEO_NOT_FOUND');
        }
      },
    );

    it.each(['ZZZZZZZZZZZ', 'abc'])(
      'answer 404 VIDEO_NOT_FOUND for unknown or malformed id %s',
      async (publicId) => {
        for (const route of routes) {
          const res = await request(app.getHttpServer())
            .get(`/videos/${publicId}${route}`)
            .expect(404);
          expect(res.body.error).toBe('VIDEO_NOT_FOUND');
        }
      },
    );
  });
});
