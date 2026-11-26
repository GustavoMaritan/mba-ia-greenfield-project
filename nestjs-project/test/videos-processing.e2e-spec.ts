import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

// Fluxo ponta a ponta com a infra real do compose. Exige o container
// video-worker rodando: `docker compose up -d video-worker`.
const SAMPLE = readFileSync(join(__dirname, 'fixtures', 'sample.mp4'));
const READY_TIMEOUT_MS = 60_000;

jest.setTimeout(120_000);

describe('Video upload → processing → delivery (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let owner: AuthenticatedUser;

  beforeAll(async () => {
    app = await createE2eApp();
    dataSource = app.get(DataSource);
    await cleanAllTables(dataSource);
    owner = await createAuthenticatedUser(app);
  });

  afterAll(async () => {
    await app.close();
  });

  function auth(req: request.Test) {
    return req.set('Authorization', `Bearer ${owner.accessToken}`);
  }

  async function uploadAndWaitReady(filename: string) {
    const created = await auth(
      request(app.getHttpServer()).post('/channels/me/videos'),
    )
      .send({
        filename,
        content_type: 'video/mp4',
        size_bytes: SAMPLE.length,
      })
      .expect(201);
    const id: string = created.body.id;

    const signed = await auth(
      request(app.getHttpServer()).post(
        `/channels/me/videos/${id}/upload-parts`,
      ),
    )
      .send({ part_numbers: [1] })
      .expect(200);
    const put = await fetch(signed.body.parts[0].url, {
      method: 'PUT',
      body: SAMPLE,
    });
    expect(put.status).toBe(200);

    await auth(
      request(app.getHttpServer()).post(
        `/channels/me/videos/${id}/upload-completion`,
      ),
    ).expect(202);

    const deadline = Date.now() + READY_TIMEOUT_MS;
    for (;;) {
      const res = await auth(
        request(app.getHttpServer()).get(`/channels/me/videos/${id}`),
      ).expect(200);
      if (res.body.status === 'ready') return res.body;
      if (res.body.status === 'failed') {
        throw new Error(`processing failed: ${res.body.failure_reason}`);
      }
      if (Date.now() > deadline) {
        throw new Error(
          'video did not become ready — is the video-worker container running?',
        );
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  it('processes the upload and serves details, stream (206), download and thumbnail', async () => {
    const video = await uploadAndWaitReady('aula 1 – introdução.mp4');

    expect(video.duration_seconds).toBeGreaterThan(2.9);
    expect(video.metadata).toMatchObject({
      width: 320,
      height: 240,
      videoCodec: 'h264',
      audioCodec: 'aac',
    });
    expect(video.processed_at).not.toBeNull();

    const details = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}`)
      .expect(200);
    expect(details.body).toMatchObject({
      public_id: video.public_id,
      title: 'aula 1 – introdução',
      stream_url: `/videos/${video.public_id}/stream`,
      download_url: `/videos/${video.public_id}/download`,
      thumbnail_url: `/videos/${video.public_id}/thumbnail`,
    });
    expect(details.body.channel.nickname).toBeTruthy();

    const stream = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/stream`)
      .expect(302);
    expect(stream.headers['cache-control']).toBe('no-store');
    const partial = await fetch(stream.headers.location, {
      headers: { Range: 'bytes=0-99' },
    });
    expect(partial.status).toBe(206);
    expect((await partial.arrayBuffer()).byteLength).toBe(100);

    const download = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/download`)
      .expect(302);
    const file = await fetch(download.headers.location);
    expect(file.status).toBe(200);
    const disposition = file.headers.get('content-disposition') ?? '';
    expect(disposition).toContain('attachment');
    expect(disposition).toContain(
      encodeURIComponent('aula 1 – introdução.mp4'),
    );
    expect((await file.arrayBuffer()).byteLength).toBe(SAMPLE.length);

    const thumbnail = await request(app.getHttpServer())
      .get(`/videos/${video.public_id}/thumbnail`)
      .expect(302);
    const jpeg = await fetch(thumbnail.headers.location);
    expect(jpeg.status).toBe(200);
    expect(jpeg.headers.get('content-type')).toBe('image/jpeg');
  });

  it('gives distinct public ids to the same file uploaded twice', async () => {
    const first = await uploadAndWaitReady('repetido.mp4');
    const second = await uploadAndWaitReady('repetido.mp4');

    expect(first.public_id).not.toBe(second.public_id);
    const a = await request(app.getHttpServer())
      .get(`/videos/${first.public_id}`)
      .expect(200);
    const b = await request(app.getHttpServer())
      .get(`/videos/${second.public_id}`)
      .expect(200);
    expect(a.body.public_id).toBe(first.public_id);
    expect(b.body.public_id).toBe(second.public_id);
  });
});
