# phase-03-videos — Progress

**Status:** in_progress
**SIs:** 5/12 completed

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
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.7 — Conclusão do upload e enfileiramento do processamento
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.8 — FfmpegService: extração de metadados (ffprobe) e thumbnail (ffmpeg)
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.9 — VideoProcessingProcessor: processamento do job, thumbnail e política de falha
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.10 — Runtime do worker: `worker.ts`, `WorkerModule` e serviço `video-worker`
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.11 — Entrega pública: detalhes, streaming, download e thumbnail por `public_id`
- **Status:** pending
- **Tests:** —
- **Observations:** none

### SI-03.12 — Documentação: CLAUDE.md, api.http, openapi.json e verificação manual de 1GB
- **Status:** pending
- **Tests:** —
- **Observations:** none
