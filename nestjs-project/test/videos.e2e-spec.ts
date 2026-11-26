import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { cleanAllTables } from '../src/test/create-test-data-source';
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
});
