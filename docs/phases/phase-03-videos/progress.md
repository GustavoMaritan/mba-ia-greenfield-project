# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 11/12 completed

### SI-03.1 — Infra: dependências, Redis, MinIO, FFmpeg e namespaces `storage`/`queue`
- **Status:** completed
- **Tests:** 14/14 passing (env.validation.integration-spec: 7, storage.config.spec: 2, queue.config.spec: 2, swagger.config.spec: 3)
- **Observations:**
  - Imagens oficiais `minio/minio` não estão mais disponíveis (pull access denied no Docker Hub e quay.io); usado `pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, como registrado na revisão de TD-02.
  - Pacotes instalados: `@nestjs/bullmq@^11.0.5`, `bullmq@^5.81.6`, `@aws-sdk/client-s3@^3.1178.0`, `@aws-sdk/s3-request-presigner@^3.1178.0`.
  - Portas do host vêm do `.env` (no meu ambiente: MinIO 9100/9101, Redis 9179, API 3200, Postgres 55434, Mailpit 3225/3226); `docker compose ps` com redis/minio healthy, `CONFIG GET maxmemory-policy` = noeviction, `ffprobe -version`/`ffmpeg -version` 5.1.9 no container, `/minio/health/live` 200 no host.
  - Baseline antes da fase: suíte unitária/integração com 1 falha pré-existente (`migrations.integration-spec` — enum `verification_tokens_type_enum` sobrava após dropar só as tabelas), corrigida na SI-03.3; e2e 52/52; `npm run lint` com 150 erros pré-existentes (tratados antes do fechamento da fase).

### SI-03.2 — StorageModule: clientes S3 (interno + público), bootstrap de buckets e operações multipart
- **Status:** completed
- **Tests:** 8/8 passing (storage.service.integration-spec: 7 contra MinIO real, storage.module.spec: 1)
- **Observations:**
  - `requestChecksumCalculation/responseChecksumValidation: 'WHEN_REQUIRED'` aplicado nos dois clientes; o PUT por `fetch` na URL assinada de `UploadPart` responde 200 com ETag.
  - O integration spec usa buckets com sufixo aleatório (removidos no `afterAll`) para provar a criação a partir do zero sem mexer nos buckets de desenvolvimento.
  - Incluído teste de Range: GET pré-assinado com `Range: bytes=0-99` responde 206 com 100 bytes.

### SI-03.3 — Entidade Video e migração CreateVideos
- **Status:** completed
- **Tests:** 10/10 passing (video.entity.integration-spec: 7, migrations.integration-spec: 3)
- **Observations:**
  - Migração gerada pela CLI: `1795675457437-CreateVideos.ts` (tipo `video_status`, unique em `public_id`, índice em `channel_id`, FK com ON DELETE CASCADE).
  - O `migrations.integration-spec` passou a recriar o schema (`DROP SCHEMA public CASCADE` + extensão `uuid-ossp`) em vez de dropar só as tabelas — corrige a falha pré-existente do enum órfão.
  - Com a relação `Channel.videos`, todo DataSource de teste precisa da entidade `Video`; os arrays `ALL_ENTITIES` dos specs existentes foram atualizados.

### SI-03.4 — VideosModule: public_id, pré-cadastro em rascunho e leitura do dono
- **Status:** completed
- **Tests:** 45 passing nos arquivos da SI (public-id.util.spec: 2, videos.service.spec: 16, videos.service.integration-spec: 4, channels.service.integration-spec: +2, videos.module.spec: 1); e2e existente 52/52 com o VideosModule no AppModule
- **Observations:**
  - Usuário sem canal também responde `VIDEO_NOT_FOUND` (não há rota de canal nesta fase; caso só ocorre com dados inconsistentes).
  - Helper `src/test/videos-test-module.ts` centraliza o módulo de teste com DB/MinIO/Redis reais e o override de `STORAGE_PUBLIC_ENDPOINT`.
  - Se o insert falhar após o `CreateMultipartUpload`, o multipart fica órfão no storage; limpeza de uploads abandonados ficou como follow-up (TD-06).

### SI-03.5 — Endpoints do dono: iniciar upload e consultar vídeo
- **Status:** completed
- **Tests:** 10/10 e2e passing (test/videos.e2e-spec.ts)
- **Observations:**
  - Criado também `test/helpers/create-e2e-app.ts` (reproduz pipes/filtros do main.ts) para os e2e de vídeos; o helper de usuário cria usuário+canal via `UsersService` e assina o token com o mesmo payload do login.
  - A conferência do `openapi.json` exportado ficou para a SI-03.12, junto da reexportação.

### SI-03.6 — Upload multipart: assinar partes e listar partes enviadas (retomada)
- **Status:** completed
- **Tests:** unit+integration de vídeos 36/36 (videos.service.spec +7, videos.service.integration-spec +1); e2e videos 19/19 (+9)
- **Observations:**
  - `test/setup-e2e-env.ts` entra em `setupFiles` do `jest-e2e.json` como `<rootDir>/setup-e2e-env.ts` (o rootDir do e2e já é `test/`).
  - Guarda de status também exige `upload_id` presente; vídeo sem upload aberto responde `VIDEO_NOT_UPLOADABLE`.

### SI-03.7 — Conclusão do upload e enfileiramento do processamento
- **Status:** completed
- **Tests:** unit+integration de vídeos 46/46 (videos.service.spec +7, video-processing.producer.integration-spec 2 com Redis real, videos.service.integration-spec +1, videos.module.spec 1); e2e videos 25/25 (+6)
- **Observations:**
  - `BullModule.forRootAsync` entrou inline no `AppModule`; a extração para fábrica reutilizável fica na SI-03.10, como o plano prevê.
  - O caminho concorrente cobre `NoSuchUpload` tanto no `ListParts` quanto no `CompleteMultipartUpload` (os dois ficam no mesmo try).
  - Helper `createVideosTestingModule` passou a registrar o `BullModule.forRootAsync`.

### SI-03.8 — FfmpegService: extração de metadados (ffprobe) e thumbnail (ffmpeg)
- **Status:** completed
- **Tests:** 13/13 passing (ffprobe-metadata.spec: 8, ffmpeg.service.integration-spec: 5 com binários reais)
- **Observations:**
  - Fixture `test/fixtures/sample.mp4` (45 KB, 3 s, 320x240, H.264+AAC) gerada com `-movflags +faststart`; `.gitattributes` marca mp4/jpg como binário (o repo usa autocrlf).
  - Erro do ffprobe com 'Invalid data found' vira `UnrecoverableError`; timeout/falha de processo segue retentável.
  - O vídeo sem áudio do teste é gerado na hora (`-an`) em vez de commitar outra fixture.

### SI-03.9 — VideoProcessingProcessor: processamento do job, thumbnail e política de falha
- **Status:** completed
- **Tests:** 75/75 em src/videos + src/video-processing (video-processing.processor.spec: 10, video-processing.processor.integration-spec: 6 com DB+MinIO+ffmpeg reais, video-processing.module.spec: 1)
- **Observations:**
  - Conferido no código do `bullmq@5.81.6` instalado (`Job.moveToFailed`): `attemptsMade` é incrementado antes do evento `failed`, então a última tentativa é `attemptsMade >= opts.attempts`.
  - No integration spec o processor é montado com `new` a partir dos serviços reais do módulo, para não subir um Worker do BullMQ dentro do processo de teste (ele competiria com o container `video-worker` pelos jobs).
  - `onFailed` é handler de evento do worker: se o `markFailed` falhar, só loga (regra de background tasks em nestjs-services.md).

### SI-03.10 — Runtime do worker: `worker.ts`, `WorkerModule` e serviço `video-worker`
- **Status:** completed
- **Tests:** 6/6 passing (worker.module.spec: 3, app.module.spec: 1, typeorm-options.factory.spec: 1, bull-root.options.spec: 1)
- **Observations:**
  - No primeiro `docker compose up video-worker` o TypeORM falhou com 'Entity metadata for Channel#user was not found': o worker só registrava Video/Channel. O `WorkerModule` passou a importar `UsersModule` e o spec ganhou a checagem de metadata (`DataSource.isInitialized`, `hasMetadata('User')`).
  - O `VideosModule` importado pelo worker traz os controllers de vídeo, mas o application context não tem adaptador HTTP — eles nunca são expostos; o spec garante que o `WorkerModule` não declara controllers nem carrega o `AuthModule`.
  - Validado: `docker compose logs video-worker` mostra 'Video worker ready (queue: video-processing)'; `docker compose stop video-worker` em 2 s; `npm run build` gera `dist/main.js` e `dist/worker.js`.
  - `--entryFile`/`--path` do Nest CLI 11 funcionaram como o plano previa (watch do worker compila em `dist-worker/`).

### SI-03.11 — Entrega pública: detalhes, streaming, download e thumbnail por `public_id`
- **Status:** completed
- **Tests:** videos.service.spec 33/33 (+5); suíte e2e completa 84/84 com o video-worker rodando (videos.e2e-spec +5, videos-processing.e2e-spec 2)
- **Observations:**
  - O fluxo ponta a ponta (`test/videos-processing.e2e-spec.ts`) usa o container `video-worker` real: upload por URL assinada → `upload-completion` → polling até `ready` → `stream` 302 cujo Location responde 206 a `Range: bytes=0-99`, `download` com `Content-Disposition: attachment` (nome UTF-8) e `thumbnail` `image/jpeg`.
  - Com `@Res()` o `@Header` do Nest não é aplicado; o `Cache-Control: no-store` dos redirects é setado direto na resposta.

### SI-03.12 — Documentação: CLAUDE.md, api.http, openapi.json e verificação manual de 1GB
- **Status:** pending
- **Tests:** —
- **Observations:** none
