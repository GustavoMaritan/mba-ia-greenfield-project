# CLAUDE.md

## Environment Startup Verification

**Default behavior:** starting the environment means starting **only infrastructure services** (database, mail, etc.) — **never** start the NestJS application server unless the user explicitly asks to run/serve the project (e.g., "rode o projeto", "suba o servidor", "run the app").

After starting infrastructure, always confirm the containers are up before proceeding:

```bash
docker compose ps   # all services must show status "running"
```

Then verify each infrastructure service is actually ready to accept connections — not just running:

- **PostgreSQL:** `docker compose exec db pg_isready -U streamtube` — expect `accepting connections`
- **Redis (queue):** `docker compose exec redis redis-cli ping` — expect `PONG`
- **MinIO (storage):** `curl -fsS http://localhost:${MINIO_API_HOST_PORT:-9000}/minio/health/live` — expect HTTP 200
- **Video worker:** `docker compose logs video-worker` — expect `Video worker ready (queue: video-processing)`

`video-worker` counts as infrastructure for this rule: it consumes the processing queue in its own container and must be up for uploads to reach `ready` (and for `test/videos-processing.e2e-spec.ts`).

Only start the NestJS dev server (`npm run start:dev`) when the user **explicitly** asks to run the application — never as part of "start the environment".

## Development Environment

This project runs inside Docker. Always use the container for development:

```bash
# Start containers
docker compose up -d

# Install dependencies (first time only)
docker compose exec nestjs-api npm install

# Run the dev server (watch mode)
docker compose exec nestjs-api npm run start:dev
```

Services (host ports come from `.env` — `API_HOST_PORT`, `DB_HOST_PORT`, `REDIS_HOST_PORT`, `MINIO_API_HOST_PORT`, `MINIO_CONSOLE_HOST_PORT`, `MAILPIT_*_HOST_PORT`; defaults in parentheses):
- `nestjs-api` — NestJS API (`3000`)
- `video-worker` — same image and volume as the API, runs `npm run start:worker:dev` (no published port)
- `db` — PostgreSQL 17 (`5432`), database `streamtube`, user/password `streamtube`
- `redis` — Redis 7.4 for the BullMQ queue (`6379`), `maxmemory-policy noeviction`
- `minio` — S3-compatible object storage, image `pgsty/minio` (official `minio/minio` images are no longer published); API (`9000`), console (`9001`), user/password = `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY`
- `mailpit` — SMTP (`1025`) and web UI (`8025`)

The image (`Dockerfile.dev`) ships `ffmpeg`/`ffprobe`, used by the worker and by `ffmpeg.service.integration-spec.ts`.

All verification and teardown commands run on the **host machine**:

```bash
# Verify NestJS is running (expect 200 + "Hello World!")
curl http://localhost:3000

# Verify PostgreSQL is ready (runs inside the db container)
docker compose exec db pg_isready -U streamtube

# Check container logs
docker compose logs nestjs-api
docker compose logs db

# Tear down the entire environment
docker compose down
```

## Commands

**Strict rule:** every `npm`, `npx`, `node`, `tsc`, and test command runs **inside the container**, never on the host. Running on the host causes env-var divergence (`DB_HOST` resolves to `localhost` instead of the Compose service), uses a different Node version, and produces results that do not reflect what runs in CI/prod.

### Container-only commands (always prefix with `docker compose exec nestjs-api`)

```bash
npm run start:dev                        # Dev server with hot-reload
npm run build                            # Compile to dist/
npm run start:prod                       # Run compiled build
npm run start:worker:dev                 # Video worker in watch mode (output in dist-worker/)
npm run start:worker:prod                # Compiled worker (dist/worker.js)
npm run openapi:export                   # Regenerate openapi.json (needs db/redis/minio up)

npm test                                 # Unit tests
npm run test:watch                       # Unit tests in watch mode
npm run test:cov                         # Coverage report
npm run test:e2e                         # End-to-end tests (always with --runInBand)

npx tsc --noEmit                         # Type-check (required before declaring a task done)
npm run lint                             # ESLint with auto-fix
npm run format                           # Prettier formatting
```

### Host-only commands (Docker / connectivity probes)

```bash
docker compose ps
docker compose logs nestjs-api
docker compose exec db pg_isready -U streamtube
curl http://localhost:3000
```

### Test execution

Integration and e2e suites share a single test database. They **must** be run with `--runInBand`:

```bash
docker compose exec nestjs-api npm test -- --runInBand
docker compose exec nestjs-api npm run test:e2e   # already configured
```

Parallel execution causes FK violations, deadlocks, and cross-suite contamination because suites truncate or seed shared tables concurrently.

During active development, run only the tests related to the file being changed (`npm test -- path/to/file.spec.ts`). Before declaring a task done, run the full suite — see the global `CLAUDE.md` → "Definition of Done (Technical)".

## Long-running Processes

Commands that never exit (dev server, watch modes) must be run in background in the Bash tool — otherwise the agent blocks indefinitely waiting for the process to return.

This applies to: `start:dev`, `start:prod`, `test:watch`, and any other persistent process.

## Test Type Selection

Choose the suffix by what the test really does, not by where the code under test lives. The suffix is a contract that drives Jest config (`testRegex`, parallelism), CI steps, and reader expectations.

| Suffix                  | Purpose                                                              | DB / external I/O | Location                     |
|-------------------------|----------------------------------------------------------------------|-------------------|------------------------------|
| `*.spec.ts`             | **Unit** — pure logic, all collaborators mocked                      | Forbidden         | Next to the source file      |
| `*.integration-spec.ts` | **Integration** — exercises real DB, real repositories, real modules | Required          | Next to the source file      |
| `*.e2e-spec.ts`         | **End-to-end** — full HTTP cycle via `supertest`                     | Required          | `nestjs-project/test/`       |

A test that constructs a `TypeOrmModule.forRoot`, opens a connection, or hits the `db` service **must** be `*.integration-spec.ts`, never `*.spec.ts`. A test that boots the full Nest application and makes HTTP calls **must** be `*.e2e-spec.ts`.

Conventions for **how to write** each kind of test (mocking patterns, AAA structure, override strategies for global guards, etc.) live in `.claude/rules/nestjs-testing.md` and load when you edit a test file.

## Jest Configuration

These settings are required in `package.json` (jest config) and `test/jest-e2e.json` for the project's tests to work correctly:

- `setupFiles: ["dotenv/config"]` — without this, `.env` is not loaded inside the Jest process. `DB_HOST`, `JWT_SECRET`, etc. fall back to undefined or to the host's `localhost`, breaking container-to-container DNS.
- `testRegex: '.*\\.(spec|integration-spec)\\.ts$'` — covers both unit (`*.spec.ts`) and integration (`*.integration-spec.ts`) suffixes.

Do not add new test-file suffixes; if a new test type is needed, update the regex deliberately.

## Environment File Conventions

`.env` is parsed by both Docker Compose and `dotenv` — values containing shell-special characters (`<`, `>`, `|`, `&`, spaces) **must be quoted** or rewritten:

```dotenv
# Wrong — the unquoted angle brackets are shell redirection syntax and break parsing
MAIL_FROM=StreamTube <noreply@streamtube.local>

# Right — quote the value
MAIL_FROM="StreamTube <noreply@streamtube.local>"
```

Whenever possible, prefer storing only the bare address in `.env` and composing display names in code (e.g., in `mail.config.ts`) so the file stays shell-safe.

## Build Assets

`tsc` (and therefore `nest build`) only emits compiled `.ts` files to `dist/`. Any non-TypeScript runtime asset — Handlebars templates (`.hbs`), JSON fixtures, static config files, etc. — must be declared in `nest-cli.json` under `compilerOptions.assets` (with `watchAssets: true` for dev). Without that, the file exists in `src/` but is missing in `dist/` and runtime fails only after build.

## Architecture

NestJS with standard module structure. Source lives in `src/`, compiled output in `dist/`.

- Each domain feature gets its own module (e.g., `UsersModule`, `VideosModule`) registered in `AppModule`
- Controllers handle HTTP routing; Services hold business logic; both are scoped to their module

## Code Conventions

- **TypeScript:** `nodenext` module resolution, `ES2023` target, `strictNullChecks` on, `noImplicitAny` off
- **Decorators:** `emitDecoratorMetadata` + `experimentalDecorators` enabled — required for NestJS DI
- **Prettier:** single quotes, trailing commas everywhere
- **ESLint:** `no-explicit-any` allowed; `no-floating-promises` and `no-unsafe-argument` are warnings

## Videos (Phase 03)

Plan and decisions: `docs/phases/phase-03-videos/` and `docs/decisions/technical-decisions-phase-03-videos.md`.

### Modules

- `src/storage/` — `StorageModule`/`StorageService` (AWS SDK v3 against MinIO). Two S3 clients: **internal** (`STORAGE_ENDPOINT=http://minio:9000`, server → storage calls) and **public** (`STORAGE_PUBLIC_ENDPOINT`, used only to sign URLs the browser will call — it must point at the host-published MinIO API port). Buckets `videos` and `thumbnails` are created idempotently on module init. Every presigned URL expires in 3600 s.
- `src/videos/` — `VideosModule`: entity `Video` (table `videos`), `VideosService`, `ChannelVideosController` (owner routes), `PublicVideosController` (anonymous routes) and `VideoProcessingProducer` (enqueues jobs). The API never consumes the queue.
- `src/video-processing/` — worker-only `VideoProcessingModule`: `VideoProcessingProcessor` (BullMQ `WorkerHost`, concurrency 2) and `FfmpegService` (`ffprobe`/`ffmpeg` via `execFile`, reading the original through an internal presigned URL with range requests — the file is never downloaded whole). **Never import it in `AppModule`.**
- `src/worker.ts` + `src/worker.module.ts` — Nest application context (no HTTP) for the `video-worker` container. Shared factories with the API: `config/config-module.options.ts`, `database/typeorm-options.factory.ts`, `config/bull-root.options.ts`.

### Endpoints

| Route | Auth | Notes |
|---|---|---|
| `POST /channels/me/videos` | JWT | Creates the `draft` and opens the S3 multipart; returns `public_id` and `upload { part_size_bytes: 64 MiB, part_count, max_parts_per_request: 100 }`. Max size 10 GiB. |
| `GET /channels/me/videos/:id` | JWT, owner | Any status. A video of another channel answers `404 VIDEO_NOT_FOUND`. |
| `POST /channels/me/videos/:id/upload-parts` | JWT, owner | Signs `part_numbers` (presigned `UploadPart`); the client `PUT`s each part straight to MinIO. `draft` only. |
| `GET /channels/me/videos/:id/upload-parts` | JWT, owner | Parts already stored (resume). `draft` only. |
| `POST /channels/me/videos/:id/upload-completion` | JWT, owner | `202`: completes the multipart (part list built from `ListParts`), moves `draft → processing`, enqueues the job. Repeating it while `processing` is harmless. |
| `GET /videos/:publicId` | public | Details, `ready` only. |
| `GET /videos/:publicId/stream`, `/download`, `/thumbnail` | public | `302` to a presigned storage URL (`Cache-Control: no-store`); storage answers `Range` with `206`. The download URL carries `Content-Disposition: attachment`. |

No endpoint accepts video bytes. Status lifecycle: `draft → processing → ready | failed` (single enum `video_status`); publication/visibility belongs to Phase 04.

### Queue and worker

- Queue `video-processing`, job `process`, payload `{ videoId }`, `jobId = videoId` (dedup), `attempts: 3`, exponential backoff starting at 5 s.
- Worker: loads the video (missing or already `ready` → skip), `ffprobe` → `duration_seconds` + `metadata` (jsonb), thumbnail frame at `min(1s, duration/2)` → `thumbnails/{videoId}/thumbnail.jpg`, then `status = ready`.
- Failure: `onFailed` sets `failed` + `failure_reason` only on the last attempt or on `UnrecoverableError` (input that is not a readable video).
- Object keys: `videos/{videoId}/original`, `thumbnails/{videoId}/thumbnail.jpg`.

### Testing notes

- Integration and e2e tests run inside `nestjs-api`, where URLs signed with `STORAGE_PUBLIC_ENDPOINT` (localhost) are unreachable. `test/setup-e2e-env.ts` and `src/test/videos-test-module.ts` override it with `STORAGE_ENDPOINT` in the test process.
- `test/videos-processing.e2e-spec.ts` needs `docker compose up -d video-worker` (it polls until `ready`, 60 s timeout).
- Never start a BullMQ `Worker` inside unit/integration tests: the processor integration spec builds the processor by hand so it does not compete with `video-worker` for jobs.
- Fixture: `test/fixtures/sample.mp4` (3 s, 320x240, H.264 + AAC).

### Manual check — large upload

Validated on 2026-11-26 with a 1.61 GiB file (26 parts of 64 MiB; half uploaded, parts listed, the rest resumed): upload straight to MinIO at ~70 MiB/s, worker reached `ready` in ~2 s reading ~6 MB through range requests, `GET /` kept answering 200 (max 5 ms) the whole time, and `docker stats` showed ~1.73 GB received by `minio` against ~0.1 MB by `nestjs-api`. To repeat it, follow the "VÍDEOS" section of `api.http` (initiate → sign parts → `curl -X PUT --upload-file <part> "<url>"` per part → completion → public routes) with the host ports from `.env`.

## REST Conventions

This is a RESTful API. All endpoints must follow standard REST conventions — correct HTTP methods, proper status codes, plural resource nouns, and consistent URL structure. Details are enforced via rules on controller files.
