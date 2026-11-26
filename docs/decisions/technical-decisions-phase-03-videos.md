---
scope_type: phase
related_phases: [3]
status: decided
date: 2026-11-26
scope_description: "Backend foundation for video upload and processing: message queue, object storage SDK and layout, browser-facing storage endpoint, 10GB resumable upload protocol, processing trigger, video status lifecycle and failure policy, worker runtime, FFmpeg source access, unique public video identifier, and streaming/download delivery."
---

# Technical Decisions — Phase 03: Upload e Processamento de Vídeos

_Subprojects in scope:_

- `nestjs-project/` — backend that delivers the videos module (upload handshake, draft pre-registration, streaming/download URLs), the video worker (FFmpeg/ffprobe), and the new infrastructure services in `compose.yaml` (object storage, queue broker). Every TD below covers it.
- `next-frontend/` — Frontend deferred: none of the Phase 03 capability bullets names a screen (upload UI and player arrive with Phase 04 "Painel de gerenciamento" and Phase 05 "Player de vídeo com controles"). No Frontend-scoped TD here. The **Cross-layer** TDs (TD-03, TD-04, TD-10, TD-11) still fix the HTTP/URL contract the future frontend will consume, and they were evaluated against the already-decided **Strict BFF** model (`next-frontend-config-base/TD-03`): bulk video bytes must never traverse the Next.js Route Handlers.

> **Assumptions recorded (conservative readings):**
> 1. MinIO is the dev object storage, per the architecture diagram ("S3 or MinIO") and the developer's brief. Note: the MinIO community edition stopped publishing official Docker images (Oct 2025) and entered maintenance mode (Dec 2025). This document does not reopen the storage server choice; it recommends an S3-portable SDK (TD-02) so the server can be swapped (pinned MinIO tag, community rebuild, or another S3-compatible server / AWS S3) without code changes. Flag for the developer.
> 2. "Rascunho" in the bullet "Pré-cadastro automático do vídeo como rascunho" is read as the **publication** state that Phase 04 ("Fluxo de rascunho → publicação") later advances — not as a processing state (see TD-06).
> 3. Inherited, not reopened: `@nestjs/config` + Joi env validation with namespaced `registerAs` (phase-01 TD-01..TD-03), UUID primary keys (existing entities), custom guards + JWT (phase-02 TD-02), domain error filter `{ statusCode, error, message }` (phase-02 TD-07).
> 4. `fluent-ffmpeg` was evaluated and excluded from all options: its README states it is deprecated, read-only, and "no longer works properly with recent ffmpeg versions". Every option invokes the `ffmpeg`/`ffprobe` binaries directly.

---

## TD-01: Message Queue Technology

**Scope:** Backend

**Capability:** Serviço de processamento em segundo plano (filas)

**Context:** The architecture diagram has a dedicated "Message Queue (TBD)" container between the API and the Video Worker. Video processing is heavy and must not block requests (project-plan "Pontos de Atenção"). The choice defines a new infrastructure service (or not), the env key contract (Joi schema + `compose.yaml` + `.env.example`), and the retry/idempotency primitives available to TD-06. Nothing queue-related is installed today.

**Options:**

### Option A: BullMQ + Redis (`@nestjs/bullmq`)
- Redis-backed queue with an official NestJS module (`BullModule.forRoot`, `registerQueue`, `@Processor` + `WorkerHost`). Adds a `redis` service to Compose.
- **Pros:** First-party NestJS integration; built-in `attempts` + exponential `backoff`, custom `jobId`/deduplication for idempotent enqueue, stalled-job recovery, concurrency per worker; mature dashboards (Bull Board). Redis can later back `@nestjs/throttler` storage.
- **Cons:** New stateful container; enqueue is not transactional with the PostgreSQL write (needs ordering care or an outbox); Redis must run with `maxmemory-policy noeviction`.

### Option B: pg-boss (PostgreSQL)
- Job queue stored in a dedicated `pgboss` schema of the existing PostgreSQL. Workers poll via `SKIP LOCKED`.
- **Pros:** Zero new infrastructure; job insert can share the DB and be made transactional with the video row update; `retryLimit`/`retryBackoff`, `singletonKey` for dedup, `expireInSeconds`, dead-letter queues.
- **Cons:** No official NestJS module (custom provider/lifecycle wiring); polling adds DB load; requires `CREATE` privilege or CLI-managed schema migrations parallel to TypeORM's; the diagram's separate queue container would collapse into the DB.

### Option C: RabbitMQ (AMQP)
- Dedicated broker; NestJS via `@nestjs/microservices` (RMQ transport) or a community module.
- **Pros:** Real broker semantics (acks, DLX, routing); language-agnostic consumers if the worker ever leaves Node.
- **Cons:** Heaviest operationally; retries with delay need DLX/TTL plumbing or plugins; Nest's RMQ transport is message-pattern oriented, not a job queue (no built-in job state, backoff or dedup).

**Recommendation:** **Option A (BullMQ + Redis)** — the only option with a first-party NestJS 11 module and job-queue primitives (retries, backoff, `jobId` dedup) that TD-06 relies on out of the box, and it matches the diagram's dedicated queue container. Option B is a genuinely close second if minimizing infrastructure is valued over Nest integration; Option C's broker features are not needed by a single job type.

**Decision:** A (BullMQ + Redis via `@nestjs/bullmq`) — Redis image pinned `redis:7.4-alpine`, started with `--maxmemory-policy noeviction`; Compose service name `redis`.
**Libraries:** @nestjs/bullmq, bullmq

---

## TD-02: Object Storage SDK and Storage Env Contract

**Scope:** Backend

**Capability:** Serviço de armazenamento de arquivos (vídeos e thumbnails)

**Context:** API (upload handshake, presigned URLs) and worker (read original, write thumbnail) both talk to S3-compatible storage. The SDK determines which multipart/presign operations are available for TD-03 and how portable the code is off MinIO (see Assumption 1). The env keys (endpoint, credentials, region, bucket names) are cross-component: Joi schema + `compose.yaml` + `.env.example` + worker. No storage SDK is installed today.

**Options:**

### Option A: AWS SDK v3 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- Official S3 client pointed at MinIO via `endpoint` + `forcePathStyle: true`. `getSignedUrl` presigns any command (`UploadPartCommand`, `GetObjectCommand`, ...).
- **Pros:** Full multipart surface (Create/UploadPart/ListParts/Complete/Abort) and presigning of each; vendor-neutral — the same code runs on AWS S3, MinIO, or any S3-compatible server; modular, typed, actively maintained.
- **Cons:** Verbose command-object API; presigned parts use `UNSIGNED-PAYLOAD` (integrity via Content-MD5/checksums if wanted); MinIO-specific admin features unavailable.

### Option B: MinIO JS client (`minio`)
- MinIO's own S3 client: `presignedPutObject`, `presignedGetObject`, `presignedUrl(method, ..., reqParams)`.
- **Pros:** Compact, ergonomic API; `listenBucketNotification` for MinIO events.
- **Cons:** No first-class presigned multipart helpers (multipart presigning needs low-level `presignedUrl` + query params); ties the codebase to a vendor now in maintenance mode.

**Recommendation:** **Option A (AWS SDK v3)** — TD-03's recommended flow needs presigned `UploadPart`, `ListParts` and `CompleteMultipartUpload`, which the AWS SDK supports natively; and given MinIO's maintenance-mode status plus the "plan storage growth and costs" attention point, portability to any S3-compatible backend is the decisive factor.

**Decision:** A (AWS SDK v3: `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`, `forcePathStyle: true` for MinIO) — env keys: `STORAGE_ENDPOINT`, `STORAGE_PUBLIC_ENDPOINT`, `STORAGE_REGION`, `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY`, `STORAGE_VIDEOS_BUCKET`, `STORAGE_THUMBNAILS_BUCKET`.
**Libraries:** @aws-sdk/client-s3, @aws-sdk/s3-request-presigner

**Revisions:**

- 2026-11-26 — Official `minio/minio` images are no longer pullable from Docker Hub/quay (verified locally: "pull access denied"); the Compose storage service uses the community rebuild `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` (same `minio server` CLI). Buckets are created idempotently by the API at startup (no `mc` sidecar). _Rationale:_ upstream image distribution changed; the S3-portable SDK choice (Option A) is unaffected — only the dev server image and bucket bootstrap are fixed here.

---

## TD-03: 10GB Upload Protocol and Resumability

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload"

**Context:** Uploads up to 10GB must not degrade the system and must resume after a connection failure ("Pontos de Atenção"). The handshake sequence lives on both sides (backend endpoints + future frontend uploader) and must respect the Strict BFF decision: streaming 10GB through a Next.js Route Handler is not viable, so bytes should bypass Next — and ideally Nest too. The upload-initiation call is also the natural moment to pre-register the draft video row. Depends on TD-02.

**Options:**

### Option A: S3 multipart with presigned part URLs, direct to storage
- API `initiate` (authenticated, via BFF) creates the draft video row + `CreateMultipartUpload`; returns `uploadId` and presigned `UploadPart` URLs; browser PUTs parts directly to storage; API `complete` calls `CompleteMultipartUpload`. Resume = `ListParts` and re-upload missing parts.
- **Pros:** Zero video bytes through Next or Nest; parallel parts; native resumability; standard S3 protocol (Uppy `@uppy/aws-s3` speaks it).
- **Cons:** Browser must reach storage directly (TD-04, CORS on bucket); several round-trips for part URLs; abandoned multipart uploads need cleanup (TD-06).

### Option B: tus protocol (`@tus/server` + `@tus/s3-store`)
- Resumable-upload standard; tus server mounted in Nest buffers chunks and forwards them as S3 multipart parts.
- **Pros:** Mature resumable protocol and clients (tus-js-client, Uppy); offset-based resume handled by the library.
- **Cons:** All 10GB flows through the API process (CPU/network/disk pressure — the "sem impacto na performance" risk); under Strict BFF it must either also pass through Next or be an exception to it; extra server-side state store.

### Option C: Custom chunked upload through the API
- Client slices the file and POSTs chunks to a Nest endpoint that appends/uploads parts.
- **Pros:** Full control; simple to reason about.
- **Cons:** Reinvents tus/S3 multipart (offset tracking, retries, integrity); same bytes-through-API cost as B; most code to own.

**Recommendation:** **Option A (presigned multipart direct to storage)** — it is the only option that keeps 10GB off both the Next.js BFF and the Nest API, gives resumability through S3's own `ListParts`, and turns the `initiate` call into the natural trigger for draft pre-registration.

**Decision:** A (presigned S3 multipart, browser → storage) — max size 10 GiB (10737418240 bytes) validated at initiation; fixed part size 64 MiB (max 160 parts, well under the 10,000 S3 limit; S3 min part 5 MiB); part URLs signed on demand per batch of part numbers, TTL 1h; resume via `ListParts`; the initiate call creates the draft video row.

---

## TD-04: Browser-Facing Storage Endpoint for Presigned URLs

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance", "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** SigV4 presigned URLs embed and sign the host. The project rule says containers must reach services by Compose service name (`http://minio:9000`), but a browser cannot resolve `minio`. Without a decision, presigned URLs generated inside the API are unusable by the browser (or vice versa). The answer defines env keys (Joi + compose + `.env.example`) and the bucket CORS policy. Depends on TD-02; consumed by TD-03 and TD-11.

**Options:**

### Option A: Dual endpoint — internal client + public presign client
- Two S3 client instances: one with `S3_ENDPOINT=http://minio:9000` for server-side calls, one with `S3_PUBLIC_ENDPOINT` (e.g. `http://localhost:9000` in dev, CDN/storage domain in prod) used only for presigning (signing is offline, no network call).
- **Pros:** Respects the service-name rule; works unchanged in prod; one extra env key.
- **Cons:** Two client instances to keep in sync; public endpoint must be reachable from browsers (port published in Compose).

### Option B: Single shared hostname for containers and browser
- One endpoint resolvable from both sides (e.g. `host.docker.internal`, or `/etc/hosts` mapping `minio` on the host).
- **Pros:** One client, one key.
- **Cons:** Breaks the Docker networking rule or depends on per-developer host setup; brittle across OSes and CI.

### Option C: Reverse proxy path in front of storage
- A proxy (Next rewrite or an nginx service) exposes storage under the app origin (e.g. `/storage/*`) and forwards to MinIO.
- **Pros:** Same-origin URLs, no bucket CORS.
- **Cons:** Host header must be preserved for signature validation; Next rewrites would put video bytes back through the BFF (contradicts TD-03's goal); extra service to operate.

**Recommendation:** **Option A (dual endpoint)** — it keeps the internal Compose service-name rule intact, needs only one extra env key, and is the same topology used in production (internal endpoint vs public storage/CDN domain).

**Decision:** A (dual endpoint) — dev values: `STORAGE_ENDPOINT=http://minio:9000` (internal, Compose service name), `STORAGE_PUBLIC_ENDPOINT=http://localhost:9100` (host-published MinIO port, used only to sign browser-facing URLs).

---

## TD-05: Bucket and Object Key Layout

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de armazenamento de arquivos (vídeos e thumbnails)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** API writes originals (TD-03), worker reads originals and writes thumbnails (TD-08/TD-09), delivery presigns reads (TD-11), and object keys are persisted in the DB. The layout is a contract between API, worker, DB columns and bucket policies (lifecycle rules, future public-read for thumbnails, Phase 04 custom thumbnails). Storage growth/cost planning is an explicit attention point.

**Options:**

### Option A: Single bucket, per-video prefix
- One bucket (e.g. `streamtube`), keys `videos/{videoId}/original`, `videos/{videoId}/thumbnail.jpg`, later `videos/{videoId}/thumbnails/custom-*`.
- **Pros:** Deleting/inspecting a video is one prefix; one bucket to provision; lifecycle rules can still target prefixes.
- **Cons:** Different access policies per asset type rely on prefix-scoped policies; mixed large/small objects in one bucket.

### Option B: One bucket per asset type
- `videos` bucket for originals, `thumbnails` bucket for images; key `{videoId}/...` in each.
- **Pros:** Clean per-bucket policies (e.g. thumbnails public-read/CDN-cached, videos private presigned); per-bucket lifecycle/quota/cost reporting.
- **Cons:** Two buckets to provision and configure (CORS, policies) in every environment; a video's assets are spread across buckets.

**Recommendation:** **Option B (bucket per asset type)** — thumbnails and originals have genuinely different access and cost profiles (small, cacheable, likely public in listings vs 10GB, private, presigned), and per-bucket policies/metrics make the growth-and-cost attention point measurable from day one; keys inside each bucket still group by `videoId`.

**Decision:** B (bucket per asset type) — buckets `videos` and `thumbnails`; keys `{videoId}/original` (videos bucket) and `{videoId}/thumbnail.jpg` (thumbnails bucket). Both buckets private.

---

## TD-06: Video Status Lifecycle and Failure Policy

**Scope:** Backend

**Capability:** Transversal — covers: "Pré-cadastro automático do vídeo como rascunho ao iniciar o upload", "Processamento automático do vídeo após upload (extração de duração e metadados)"

**Context:** A video row exists from upload start (TD-03) and moves through upload, processing, ready/failed. Phase 04 adds "Fluxo de rascunho → publicação", so the status model chosen now must not collide with it. The policy must also cover retries, idempotent reprocessing, and abandoned uploads. Depends on TD-01 (retry primitives) and TD-07.

**Options:**

### Option A: Orthogonal statuses — processing status separate from publication status
- `processingStatus`: `uploading → processing → ready | failed`; `publicationStatus` set to `draft` at creation (Phase 04 adds `published`). Queue retries with exponential backoff; terminal `failed` after N attempts; processor idempotent (deterministic keys, overwrite); storage lifecycle rule aborts incomplete multipart uploads after N days.
- **Pros:** Phase 04 extends publication without touching processing; "draft but still processing" is representable; clear failure semantics.
- **Cons:** Two enums to keep consistent (e.g. cannot publish unless `ready`).

### Option B: Single combined status enum
- One column: `draft_uploading → draft_processing → draft_ready → published`, plus `failed`.
- **Pros:** One field; simple listing filters.
- **Cons:** Combinatorial growth as Phase 04 adds visibility/publication and reprocessing (custom thumbnail); Phase 04 must rewrite Phase 03's enum.

### Option C: Single status + separate jobs table
- Video row keeps a coarse status; a `video_jobs` table records each attempt (error, timestamps).
- **Pros:** Full processing audit trail independent of the queue's retention.
- **Cons:** Duplicates what the queue already stores (attempts, failedReason); more schema and sync logic for a single job type.

**Recommendation:** **Option A (orthogonal statuses)** — it reads "rascunho" as the publication state that Phase 04 owns, so Phase 03 never has to be rewritten, and it delegates retry bookkeeping to the queue (TD-01) instead of duplicating it in the schema.

**Decision:** B (single combined status enum), parameterized to the phase brief — one `status` column with values `draft → processing → ready | failed` ("rascunho → processando → pronto/erro"); `draft` = pre-registered while the upload is in progress. Publication/visibility (Phase 04 "Fluxo de rascunho → publicação", public/unlisted) will be added by Phase 04 as its own column; Phase 03 does not model it. Failure policy: BullMQ `attempts: 3` with exponential backoff (base 5s); the processor is idempotent (deterministic keys, overwrite); after the final attempt the worker sets `status=failed` and stores a short `failure_reason`. Abandoned multipart uploads: cleanup deferred (out of scope, follow-up).
**Note:** Decision deliberately diverges from the Recommendation (A) — the developer kept a single status column matching the phase brief; Phase 04 adds publication as a separate column, so the orthogonality concern is addressed then without rewriting this enum.

---

## TD-07: Processing Trigger After Upload Completion

**Scope:** Backend

**Capability:** Processamento automático do vídeo após upload (extração de duração e metadados)

**Context:** Something must move the video from `uploading` to `processing` and enqueue the job once the last byte lands. With direct-to-storage uploads (TD-03 A), the API does not see the bytes, so the trigger is either the client's completion call or a storage event. Affects idempotency (duplicate triggers) and Compose config (bucket notification targets). Depends on TD-01, TD-03, TD-06.

**Options:**

### Option A: API `complete` endpoint enqueues
- Client calls `POST /videos/:id/upload/complete`; API calls `CompleteMultipartUpload`, sets `processing`, enqueues with `jobId = videoId`.
- **Pros:** One code path, owner-authorized, synchronous error feedback; dedup via deterministic `jobId`; no storage-specific config.
- **Cons:** If the client dies after the last part but before `complete`, the upload stays `uploading` (resume flow or cleanup handles it).

### Option B: Storage bucket notification
- MinIO publishes `s3:ObjectCreated:CompleteMultipartUpload` to a webhook/Redis/AMQP target that enqueues.
- **Pros:** Triggers on the storage fact itself, independent of the client.
- **Cons:** MinIO-specific config (notification targets, ARNs) — non-portable (TD-02); events are at-least-once and unordered; the API still needs an endpoint to complete the multipart upload, so two paths exist.

### Option C: Periodic reconciler
- A scheduled job scans `uploading` videos and checks storage (`HeadObject`/`ListParts`).
- **Pros:** Self-healing for lost triggers.
- **Cons:** Latency equals the polling interval; extra load; useful only as a complement.

**Recommendation:** **Option A (API `complete` endpoint)** — the API must call `CompleteMultipartUpload` anyway in TD-03's flow, so enqueuing there is the single, portable, authorized trigger; `jobId = videoId` makes duplicate calls harmless. Option C can be added later as a safety net.

**Decision:** A (API `complete` endpoint enqueues; `jobId = videoId`) — transition `draft → processing` happens in the same request after `CompleteMultipartUpload` succeeds; enqueue after the DB update.

---

## TD-08: Video Worker Runtime

**Scope:** Backend

**Capability:** Transversal — covers: "Serviço de processamento em segundo plano (filas)", "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** The diagram shows a separate "Video Worker (FFmpeg)" container. FFmpeg work is CPU/IO heavy and must not affect API latency. The runtime choice determines the Compose topology, whether the API image carries FFmpeg (current `Dockerfile.dev` is `node:25-slim` without it), and how domain code (entities, storage service) is shared. Depends on TD-01.

**Options:**

### Option A: Separate container, same NestJS codebase, worker entrypoint
- Second entrypoint (e.g. `main-worker.ts` with `NestFactory.createApplicationContext`) loads only queue processor + storage + videos persistence modules; Compose service `video-worker` from an image that adds `ffmpeg`.
- **Pros:** Process/CPU isolation from the API; reuses entities, config (Joi), storage service; scales independently (replicas).
- **Cons:** Second Compose service and image variant; module boundaries must allow loading a subset without HTTP.

### Option B: In-process processor inside the API
- `@Processor` registered in the API app (optionally BullMQ sandboxed child processes).
- **Pros:** Zero new service; simplest setup.
- **Cons:** FFmpeg competes with HTTP traffic for CPU/memory ("sem impacto na performance" risk); API image must include FFmpeg; scaling API scales workers.

### Option C: Standalone worker service outside the Nest app
- Independent Node (or other language) service with its own code consuming the queue.
- **Pros:** Maximum decoupling; free choice of runtime.
- **Cons:** Duplicates entities/config/storage code or requires a shared package (monorepo tooling not in place); two codebases to test.

**Recommendation:** **Option A (separate container, same codebase)** — it matches the diagram's dedicated worker, keeps FFmpeg off the API's CPU budget, and reuses the existing entities/config without introducing monorepo package tooling.

**Decision:** A (separate `video-worker` Compose service, same NestJS codebase) — standalone application context entrypoint `src/worker.ts`; image with `ffmpeg`/`ffprobe` installed.

---

## TD-09: FFmpeg Source Access for Metadata and Thumbnail Extraction

**Scope:** Backend

**Capability:** Transversal — covers: "Processamento automático do vídeo após upload (extração de duração e metadados)", "Geração automática de thumbnail a partir de um frame do vídeo"

**Context:** `ffprobe` (duration, codecs, resolution) and `ffmpeg` (one frame → thumbnail) need to read an original of up to 10GB. Whether the worker copies the file locally or reads it over HTTP drives worker disk sizing (a Compose volume), network cost, and job duration. Both options invoke the binaries directly via `child_process` (see Assumption 4). Depends on TD-02, TD-08.

**Options:**

### Option A: Read from a presigned GET URL (HTTP range input)
- Worker presigns a short-lived GET (internal endpoint) and passes the URL to `ffprobe`/`ffmpeg`, which fetch only the byte ranges they need.
- **Pros:** No local copy of 10GB; probe and single-frame seek usually read a few MB; no scratch volume.
- **Cons:** MP4s with the `moov` atom at the end need an extra range read; network hiccups fail the job (retried by TD-06); future full transcoding would read everything anyway.

### Option B: Download original to a worker scratch volume
- Stream the object to a temp file, run tools on the local path, delete afterwards.
- **Pros:** Local seeks are fast and deterministic; same pattern works for future transcoding.
- **Cons:** Copies up to 10GB per job for a few MB of actual reads; scratch volume must be sized for concurrency × 10GB; cleanup on crash.

**Recommendation:** **Option A (presigned URL input)** — Phase 03 only needs metadata and one frame, which FFmpeg resolves with a handful of range requests; copying 10GB per job would make worker disk the bottleneck. Option B becomes relevant only if full transcoding (e.g. HLS, TD-11 C) is adopted later.

**Decision:** A (presigned GET URL input) — `ffprobe`/`ffmpeg` read the original via a presigned GET signed with the INTERNAL endpoint, TTL 1h; thumbnail = single JPEG frame at `min(1s, duration/2)`, uploaded to the thumbnails bucket.

---

## TD-10: Unique Public Video Identifier

**Scope:** Cross-layer

**Capability:** URL única por vídeo, sem conflito com outros vídeos

**Context:** Each video needs a URL that never conflicts with another; the attention point asks for a **short** unique URL. The identifier format becomes part of API routes and future frontend routes (`/watch/{id}`) and of unlisted-link semantics (Phase 04: "somente via link" — must be unguessable). Existing entities use UUID primary keys. `nanoid` is present only transitively (3.3.11, CommonJS); v5 is ESM-only, which the project's `nodenext` CommonJS output can load only via Node 25's `require(esm)` or by pinning 3.x.

**Options:**

### Option A: Expose the UUID primary key
- URL uses the existing `uuid` PK (`/watch/3f9c...-...`).
- **Pros:** Zero new column or dependency; globally unique and unguessable.
- **Cons:** 36-char URLs — contradicts the "URL curta" attention point; leaks the internal key into the public contract.

### Option B: Random short public ID (nanoid-style) in a unique column
- Separate `publicId` column (e.g. 11 chars, URL-safe alphabet) with a unique index; generated at draft creation; retry on the (astronomically rare) unique-violation. Via `nanoid` `customAlphabet` or `crypto.randomBytes` + base62.
- **Pros:** Short, URL-safe, unguessable (fits unlisted links); decouples public URL from PK.
- **Cons:** Extra column/index; collision handling path (trivial but must exist); dependency/ESM caveat if using nanoid v5.

### Option C: Hashids/Sqids over a sequential integer
- Encode an auto-increment integer into a short string.
- **Pros:** Very short; deterministic; no collision handling.
- **Cons:** Reversible and enumerable (encoding, not encryption) — breaks unlisted-link privacy; requires an integer sequence beside the UUID PK.

**Recommendation:** **Option B (random short public ID)** — the only option that is both short (attention point) and unguessable, which Phase 04's unlisted visibility depends on; UUID stays as the internal PK so existing conventions are untouched.

**Decision:** B (random short public ID in a unique column `public_id`) — generated with `node:crypto` (11 chars, base62); no `nanoid` dependency (avoids the ESM-only v5 issue); retry on unique violation.

---

## TD-11: Streaming and Download Delivery

**Scope:** Cross-layer

**Capability:** Transversal — covers: "Reprodução via streaming (sem necessidade de download completo)", "Download do vídeo pelo usuário"

**Context:** Playback must start without downloading the whole file, and users can download the video. The delivery path determines whether video bytes cross the API (and, under Strict BFF, Next), what URL the future `<video>` element receives, and whether the worker must transcode. The architecture diagram already shows "Frontend → Object Storage: Streams". Depends on TD-04 (public endpoint) and TD-10 (identifier in the route).

**Options:**

### Option A: Presigned GET URLs served directly by storage
- API resolves `publicId` → returns (or 302-redirects to) a short-lived presigned GET; storage serves HTTP Range/206 natively. Download = presign with `ResponseContentDisposition: attachment`.
- **Pros:** Zero bytes through API/BFF; native seeking via Range; download is the same mechanism with one parameter; CDN-friendly later.
- **Cons:** Progressive playback of the original only (no adaptive bitrate); MP4s without `faststart` need an extra range read before playing; URLs expire (player must refresh on long sessions).

### Option B: API proxy with Range passthrough
- Nest endpoint reads the object (`GetObject` with `Range`) and pipes it with 206 headers.
- **Pros:** Full control per request (auth, view counting, URL never exposed).
- **Cons:** Every byte of every view crosses the API (and Next under Strict BFF) — the opposite of "sem impacto na performance"; more code for Range edge cases.

### Option C: HLS transcoding + segment delivery
- Worker transcodes to HLS renditions; player (hls.js) fetches playlists/segments from storage.
- **Pros:** Adaptive bitrate, fastest start on slow networks; industry-standard streaming.
- **Cons:** Heavy CPU per video and multiplied storage (cost attention point); much longer processing; download still needs the original; beyond the bullet's scope of "extração de duração e metadados".

**Recommendation:** **Option A (presigned GET from storage)** — it satisfies streaming via native Range requests and download via one presign parameter, with zero load on API/BFF and no transcoding cost; HLS (Option C) can be layered later as a worker job without changing the public contract.

**Decision:** A (presigned GET from storage) — the API exposes stable routes that answer `302 Found` to a presigned URL signed with the PUBLIC endpoint (TTL 1h): stream (inline), download (`ResponseContentDisposition: attachment` with the original filename), thumbnail. Storage serves Range/206 natively.

---

## Decisions Summary

| ID | Scope | Decision | Recommendation | Choice |
|----|-------|----------|---------------|--------|
| TD-01 | Backend | Message Queue Technology | A (BullMQ + Redis) | A (BullMQ + Redis) |
| TD-02 | Backend | Object Storage SDK and Storage Env Contract | A (AWS SDK v3) | A (AWS SDK v3) |
| TD-03 | Cross-layer | 10GB Upload Protocol and Resumability | A (Presigned multipart direct to storage) | A (Presigned multipart direct to storage) |
| TD-04 | Cross-layer | Browser-Facing Storage Endpoint for Presigned URLs | A (Dual endpoint) | A (Dual endpoint) |
| TD-05 | Backend | Bucket and Object Key Layout | B (Bucket per asset type) | B (Bucket per asset type) |
| TD-06 | Backend | Video Status Lifecycle and Failure Policy | A (Orthogonal processing/publication statuses) | B (Single combined status enum) |
| TD-07 | Backend | Processing Trigger After Upload Completion | A (API `complete` endpoint enqueues) | A (API `complete` endpoint enqueues) |
| TD-08 | Backend | Video Worker Runtime | A (Separate container, same codebase) | A (Separate container, same codebase) |
| TD-09 | Backend | FFmpeg Source Access for Metadata and Thumbnail | A (Presigned URL input) | A (Presigned URL input) |
| TD-10 | Cross-layer | Unique Public Video Identifier | B (Random short public ID) | B (Random short public ID) |
| TD-11 | Cross-layer | Streaming and Download Delivery | A (Presigned GET from storage) | A (Presigned GET from storage) |
