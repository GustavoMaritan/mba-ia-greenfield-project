import { randomBytes, randomUUID } from 'node:crypto';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import {
  DeleteBucketCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import storageConfig from '../config/storage.config';
import { S3_INTERNAL_CLIENT, StorageBucket } from './storage.constants';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

const MiB = 1024 * 1024;

async function buildModule(): Promise<TestingModule> {
  const module = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
      StorageModule,
    ],
  }).compile();
  await module.init();
  return module;
}

async function emptyAndDeleteBucket(s3: S3Client, bucket: string) {
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: bucket }));
  for (const obj of listed.Contents ?? []) {
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
  }
  await s3.send(new DeleteBucketCommand({ Bucket: bucket }));
}

describe('StorageService (integration)', () => {
  const originalEnv = { ...process.env };
  const suffix = randomBytes(4).toString('hex');
  const videosBucket = `test-videos-${suffix}`;
  const thumbnailsBucket = `test-thumbs-${suffix}`;
  let module: TestingModule;
  let service: StorageService;
  let s3: S3Client;

  beforeAll(async () => {
    process.env.STORAGE_VIDEOS_BUCKET = videosBucket;
    process.env.STORAGE_THUMBNAILS_BUCKET = thumbnailsBucket;
    // o teste roda dentro do container: as URLs "públicas" precisam alcançar o minio
    process.env.STORAGE_PUBLIC_ENDPOINT = process.env.STORAGE_ENDPOINT;

    module = await buildModule();
    service = module.get(StorageService);
    s3 = module.get(S3_INTERNAL_CLIENT);
  });

  afterAll(async () => {
    await emptyAndDeleteBucket(s3, videosBucket);
    await emptyAndDeleteBucket(s3, thumbnailsBucket);
    await module.close();
    process.env = originalEnv;
  });

  describe('bucket bootstrap', () => {
    it('should create both buckets on init', async () => {
      await expect(
        s3.send(new HeadBucketCommand({ Bucket: videosBucket })),
      ).resolves.toBeDefined();
      await expect(
        s3.send(new HeadBucketCommand({ Bucket: thumbnailsBucket })),
      ).resolves.toBeDefined();
    });

    it('should be idempotent when the buckets already exist', async () => {
      await expect(service.onModuleInit()).resolves.toBeUndefined();
    });
  });

  describe('multipart upload', () => {
    it('should upload parts through presigned URLs, list them and complete', async () => {
      const key = `${randomUUID()}/original`;
      const part1 = randomBytes(5 * MiB);
      const part2 = randomBytes(1024);
      const uploadId = await service.createMultipartUpload(key, 'video/mp4');

      const url1 = await service.presignUploadPart(key, uploadId, 1);
      const url2 = await service.presignUploadPart(key, uploadId, 2);
      expect(url1).toContain(new URL(process.env.STORAGE_ENDPOINT!).host);
      expect(url1).toContain('X-Amz-Expires=3600');

      const res1 = await fetch(url1, { method: 'PUT', body: part1 });
      const res2 = await fetch(url2, { method: 'PUT', body: part2 });
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res1.headers.get('etag')).toBeTruthy();

      const parts = await service.listParts(key, uploadId);
      expect(parts.map((p) => [p.partNumber, p.size])).toEqual([
        [1, part1.length],
        [2, part2.length],
      ]);

      await service.completeMultipartUpload(key, uploadId, parts);

      const head = await s3.send(
        new HeadObjectCommand({ Bucket: videosBucket, Key: key }),
      );
      expect(head.ContentLength).toBe(part1.length + part2.length);
    });

    it('should list no parts before anything is uploaded', async () => {
      const key = `${randomUUID()}/original`;
      const uploadId = await service.createMultipartUpload(key, 'video/mp4');

      await expect(service.listParts(key, uploadId)).resolves.toEqual([]);
    });
  });

  describe('object access', () => {
    it('should put an object and download it through an internal presigned URL', async () => {
      const key = `${randomUUID()}/thumbnail.jpg`;
      const body = Buffer.from('fake-jpeg-bytes');
      await service.putObject(
        StorageBucket.Thumbnails,
        key,
        body,
        'image/jpeg',
      );

      const url = await service.presignInternalGet(
        StorageBucket.Thumbnails,
        key,
      );
      expect(url).toContain(new URL(process.env.STORAGE_ENDPOINT!).host);

      const res = await fetch(url);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/jpeg');
      expect(Buffer.from(await res.arrayBuffer())).toEqual(body);
    });

    it('should honour Range requests on a public presigned GET', async () => {
      const key = `${randomUUID()}/original`;
      await service.putObject(
        StorageBucket.Videos,
        key,
        randomBytes(1000),
        'video/mp4',
      );

      const url = await service.presignPublicGet(StorageBucket.Videos, key);
      const res = await fetch(url, { headers: { Range: 'bytes=0-99' } });

      expect(res.status).toBe(206);
      expect((await res.arrayBuffer()).byteLength).toBe(100);
    });

    it('should set an attachment Content-Disposition when downloadFilename is given', async () => {
      const key = `${randomUUID()}/original`;
      const filename = 'aula 1 – introdução.mp4';
      await service.putObject(
        StorageBucket.Videos,
        key,
        Buffer.from('video'),
        'video/mp4',
      );

      const url = await service.presignPublicGet(StorageBucket.Videos, key, {
        downloadFilename: filename,
      });
      expect(url).toContain('response-content-disposition');

      const res = await fetch(url);
      const disposition = res.headers.get('content-disposition') ?? '';
      expect(disposition).toContain('attachment');
      expect(disposition).toContain(encodeURIComponent(filename));
    });
  });
});
