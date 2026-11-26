---
libs:
  "@nestjs/bullmq":
    version: "^11.x"
    context7_id: "/nestjs/bull"
    fetched_at: "2026-11-26T03:14:47-03:00"
  bullmq:
    version: "^5.x"
    context7_id: "/taskforcesh/bullmq"
    fetched_at: "2026-11-26T03:14:47-03:00"
  "@aws-sdk/client-s3":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-26T03:14:47-03:00"
  "@aws-sdk/s3-request-presigner":
    version: "^3.x"
    context7_id: "/aws/aws-sdk-js-v3"
    fetched_at: "2026-11-26T03:14:47-03:00"
sources_mtime:
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-26T03:16:32-03:00"
---

# phase-03-videos — Library References

Distilled docs for libraries decided in this slice. Pulled via Context7. Re-fetch when the underlying TD changes (resolve refreshes this file when the lib set in `## Decisions Index` drifts from the cached set here). None of these packages is installed yet — pin exact versions at install time and confirm against the installed `package.json` (NestJS core is `^11.0.1`).

## @nestjs/bullmq

**Source:** `/nestjs/bull` (Context7) — High reputation, 499 snippets, version `_nestjs_bull_11.0.5` available. Maps to `phase-03-videos/TD-01` Decision A.

### Root connection via config (async)

Follows the project convention of namespaced `registerAs` config (phase-01 TD-01..TD-03): a `queueConfig` (e.g. `REDIS_HOST=redis`, `REDIS_PORT=6379`) injected into `forRootAsync`.

```typescript
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [queueConfig.KEY],
      useFactory: (cfg: ConfigType<typeof queueConfig>) => ({
        connection: { host: cfg.host, port: cfg.port },
      }),
    }),
    BullModule.registerQueue({ name: 'video-processing' }),
  ],
})
export class QueueModule {}
```

### Producer (API side)

```typescript
@Injectable()
export class VideoProcessingProducer {
  constructor(@InjectQueue('video-processing') private readonly queue: Queue) {}

  enqueue(videoId: string) {
    return this.queue.add('process', { videoId }, {
      jobId: videoId,                                  // TD-07: dedup
      attempts: 3,                                     // TD-06
      backoff: { type: 'exponential', delay: 5000 },   // TD-06: base 5s
    });
  }
}
```

### Consumer (worker side)

A class decorated with `@Processor(name, workerOptions?)` **must extend `WorkerHost`** and implement `process(job, token?)`; otherwise `InvalidProcessorClassError` is thrown at registration. Throwing inside `process` fails the job and triggers retry per job options. `this.worker` is only available after `onModuleInit` registration (safe in `onApplicationBootstrap`, not in the constructor).

```typescript
@Processor('video-processing', { concurrency: 2 })
export class VideoProcessingConsumer extends WorkerHost {
  async process(job: Job<{ videoId: string }>): Promise<void> {
    // probe → thumbnail → persist metadata → status=ready
  }
}
```

### Key contracts for Phase 03

- The processor provider must be registered **only** in the worker application context (`src/worker.ts`, TD-08) — if the module containing it is imported by the API's `AppModule`, the API also consumes jobs. Keep the processor in a worker-only module; the API imports just `registerQueue` + producer.
- Module with `BullModule.registerQueue()` → compilation test (testing guide).

---

## bullmq

**Source:** `/taskforcesh/bullmq` (Context7) — High reputation, 5114 snippets, versions up to v5.81.x / v6.5.x listed. Maps to `phase-03-videos/TD-01` + `TD-06` + `TD-07`.

### Retries and backoff

Without `attempts`, failed jobs are not retried; without `backoff`, retries are immediate. Built-in `exponential` backoff delay = `2^(attemptsMade-1) * delay` → with base 5s: 5s, 10s.

### Deterministic jobId

`jobId` must be unique within the queue; adding a job with an existing id is **ignored** (dedup). Avoid `:` and digit-only ids — a UUID `videoId` is fine. Jobs already removed (`removeOnComplete` / `removeOnFail`) are **not** considered duplicates, so a re-trigger after removal enqueues again (acceptable: the processor is idempotent).

### Detecting the final failure (TD-06: set `status=failed`)

A job is retried only while `attemptsMade + 1 < opts.attempts` and the error is not an `UnrecoverableError`. To mark the video failed only after the last attempt, check inside the `failed` handler (or in `process` before rethrowing):

```typescript
const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
```

Throw `UnrecoverableError` (from `bullmq`) for non-retriable inputs (e.g. ffprobe says the file is not a video) to skip remaining attempts.

### Redis requirement

Redis must run with `maxmemory-policy noeviction` (TD-01: `redis:7.4-alpine --maxmemory-policy noeviction`).

---

## @aws-sdk/client-s3

**Source:** `/aws/aws-sdk-js-v3` (Context7) — High reputation, 13647 snippets. Maps to `phase-03-videos/TD-02` Decision A (+ TD-03, TD-04, TD-05).

### Client for MinIO

`forcePathStyle` is read **only** from the client constructor (no env var / shared-config selector) and defaults to `false` — it must be set explicitly for MinIO.

```typescript
const internal = new S3Client({
  endpoint: cfg.endpoint,            // STORAGE_ENDPOINT=http://minio:9000
  region: cfg.region,                // STORAGE_REGION
  forcePathStyle: true,
  credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
});
// TD-04: second instance with endpoint = STORAGE_PUBLIC_ENDPOINT (http://localhost:9100),
// used ONLY for presigning browser-facing URLs (signing is offline).
```

### Multipart surface (TD-03)

- `CreateMultipartUploadCommand({ Bucket, Key, ContentType })` → `UploadId`.
- `UploadPartCommand({ Bucket, Key, UploadId, PartNumber })` — presigned per part (browser PUTs the 64 MiB chunk). `PartNumber` is 1..10,000.
- `ListPartsCommand({ Bucket, Key, UploadId })` → parts already stored (resume).
- `CompleteMultipartUploadCommand({ Bucket, Key, UploadId, MultipartUpload: { Parts: [{ ETag, PartNumber }] } })`. Missing/invalid `Parts` → 400.
- `AbortMultipartUploadCommand` exists for the deferred cleanup follow-up.
- Bucket bootstrap at API startup (TD-02 revision): `HeadBucketCommand` → `CreateBucketCommand` when absent (idempotent).

### Checksum note (verify at install)

Recent v3 releases default to `requestChecksumCalculation: "WHEN_SUPPORTED"`, which can add `x-amz-checksum-*` parameters to presigned `UploadPart` URLs that the browser cannot satisfy and that some S3-compatible servers reject. If presigned part uploads fail with checksum/signature errors, construct the clients with `requestChecksumCalculation: "WHEN_REQUIRED"` and `responseChecksumValidation: "WHEN_REQUIRED"`. _(Not returned by the Context7 query — confirm against the installed version's docs before relying on it.)_

---

## @aws-sdk/s3-request-presigner

**Source:** `/aws/aws-sdk-js-v3` (Context7, `packages/s3-request-presigner`). Maps to `phase-03-videos/TD-03`, `TD-09`, `TD-11`.

```typescript
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// TD-03: part URL (public client), TTL 1h
await getSignedUrl(publicClient, new UploadPartCommand({ Bucket, Key, UploadId, PartNumber }), { expiresIn: 3600 });

// TD-11: download (public client)
await getSignedUrl(publicClient, new GetObjectCommand({
  Bucket, Key,
  ResponseContentDisposition: `attachment; filename="${originalName}"`,
}), { expiresIn: 3600 });

// TD-09: ffprobe/ffmpeg input (INTERNAL client)
await getSignedUrl(internalClient, new GetObjectCommand({ Bucket, Key }), { expiresIn: 3600 });
```

- `expiresIn` defaults to **900 s** when omitted — always pass 3600 explicitly (TD-03/TD-09/TD-11).
- Every presigned URL uses `X-Amz-Content-Sha256: UNSIGNED-PAYLOAD` and treats `content-type` as unsignable — part bodies are not hashed; integrity, if wanted, needs `Content-MD5`/`Checksum*` headers (via `unhoistableHeaders`). Not required in Phase 03.
- Escape/quote the original filename in `ResponseContentDisposition` (RFC 6266 `filename*=UTF-8''…` for non-ASCII names).

---

## Non-npm notes

### ffmpeg / ffprobe (CLI)

Invoked directly via `node:child_process` (`execFile`/`spawn`, never a shell string) — `fluent-ffmpeg` is excluded (deprecated). Installed in the `video-worker` image (TD-08).

- Probe: `ffprobe -v error -print_format json -show_format -show_streams <presignedUrl>` → `format.duration`, `format.format_name`, `format.bit_rate`, `format.size`; video stream `width`, `height`, `codec_name`, `avg_frame_rate` (fraction string, e.g. `30000/1001`); audio stream `codec_name` (may be absent → `audioCodec: null`). Feeds AMB-1 fields.
- Thumbnail: `ffmpeg -v error -ss <min(1, duration/2)> -i <presignedUrl> -frames:v 1 -q:v 2 -f image2 <tmp>.jpg` (input-side `-ss` = fast seek via HTTP range) → upload to `thumbnails/{videoId}/thumbnail.jpg`.

### node:crypto (TD-10 public ID)

`randomBytes`/`randomInt` from `node:crypto` → 11 chars over base62 alphabet. Use rejection sampling or `randomInt(62)` per char to avoid modulo bias. Retry on unique-violation of `public_id` (PostgreSQL error code `23505`).
