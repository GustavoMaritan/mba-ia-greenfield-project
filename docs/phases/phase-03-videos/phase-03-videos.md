---
kind: phase
name: phase-03-videos
test_specs_aware: true
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-26T03:18:16-03:00"
  docs/phases/phase-03-videos/library-refs.md: "2026-11-26T03:18:09-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-26T03:16:32-03:00"
  docs/decisions/technical-decisions-openapi-docs-nestjs.md: "2026-11-26T02:47:35-03:00"
---

# Phase 03 — Upload e Processamento de Vídeos

## Objective

Entregar o upload de vídeos de até 10GB direto para o armazenamento de arquivos (multipart pré-assinado, sem passar pela API), com pré-cadastro automático do vídeo como rascunho ao iniciar o upload, processamento automático em segundo plano via fila (extração de duração e metadados + geração de thumbnail a partir de um frame), URL única por vídeo sem conflito e reprodução via streaming e download do vídeo pelo usuário.

---

## Step Implementations

### SI-03.1 — Infra: dependências, Redis, MinIO, FFmpeg e namespaces `storage`/`queue`

**Description:** Prepara a infraestrutura da fase — pacotes, serviços `redis` e `minio` no Compose, FFmpeg na imagem de desenvolvimento e os namespaces de configuração validados por Joi — sem nenhum comportamento de domínio ainda.

**Technical actions:**

1. Instalar no `nestjs-project` (dentro do container): `@nestjs/bullmq`, `bullmq`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner` (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`); fixar as versões instaladas e conferir as APIs no context7 contra `library-refs.md` (checksum dos presigned URLs, `WorkerHost`).
2. Atualizar `nestjs-project/Dockerfile.dev` — acrescentar `ffmpeg` ao `apt install` (traz `ffmpeg` e `ffprobe`) (per `phase-03-videos/TD-08`, `phase-03-videos/TD-09`). A mesma imagem servirá `nestjs-api` e o futuro `video-worker`.
3. Atualizar `nestjs-project/compose.yaml` — serviço `redis` (`redis:7.4-alpine`, `command: redis-server --maxmemory-policy noeviction`, porta `${REDIS_HOST_PORT:-6379}:6379`, healthcheck `redis-cli ping`) (per `phase-03-videos/TD-01`); serviço `minio` (`pgsty/minio:RELEASE.2026-08-04T00-00-00Z`, `command: server /data --console-address :9001`, `MINIO_ROOT_USER=${STORAGE_ACCESS_KEY:-streamtube}`, `MINIO_ROOT_PASSWORD=${STORAGE_SECRET_KEY:-streamtube-secret}`, portas `${MINIO_API_HOST_PORT:-9000}:9000` e `${MINIO_CONSOLE_HOST_PORT:-9001}:9001`, volume nomeado `minio-data`, healthcheck em `http://localhost:9000/minio/health/live`) (per `phase-03-videos/TD-02` revisão 2026-11-26); `nestjs-api` passa a depender de `redis` e `minio` com `condition: service_healthy`.
4. Criar `src/config/storage.config.ts` — `registerAs('storage', ...)` com `endpoint` (`STORAGE_ENDPOINT`, default `http://minio:9000`), `publicEndpoint` (`STORAGE_PUBLIC_ENDPOINT`, default `http://localhost:9000`), `region` (`STORAGE_REGION`, default `us-east-1`), `accessKey` (`STORAGE_ACCESS_KEY`), `secretKey` (`STORAGE_SECRET_KEY`), `videosBucket` (`STORAGE_VIDEOS_BUCKET`, default `videos`), `thumbnailsBucket` (`STORAGE_THUMBNAILS_BUCKET`, default `thumbnails`) (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`, `phase-03-videos/TD-05`); criar `src/config/queue.config.ts` — `registerAs('queue', ...)` com `host` (`REDIS_HOST`, default `redis`) e `port` (`REDIS_PORT`, default `6379`) (per `phase-01-configuracao-base/TD-03`); registrar ambos no `load` do `ConfigModule.forRoot` em `AppModule`.
5. Atualizar `src/config/env.validation.ts` (Joi: `STORAGE_ENDPOINT`/`STORAGE_PUBLIC_ENDPOINT` como `uri`, `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` obrigatórios, demais com default; `REDIS_HOST`, `REDIS_PORT`) e `.env.example` (novas variáveis + `REDIS_HOST_PORT`, `MINIO_API_HOST_PORT`, `MINIO_CONSOLE_HOST_PORT` comentadas, com nota de que `STORAGE_PUBLIC_ENDPOINT` deve apontar para a porta publicada da API do MinIO no host) (per `phase-01-configuracao-base/TD-02`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `envValidationSchema` | Integration: `STORAGE_ACCESS_KEY`/`STORAGE_SECRET_KEY` obrigatórios, defaults de `storage`/`queue`, `STORAGE_PUBLIC_ENDPOINT` precisa ser URI | `src/config/env.validation.integration-spec.ts` |
| `storageConfig` / `queueConfig` | Unit: factories leem env e aplicam defaults | `src/config/storage.config.spec.ts`, `src/config/queue.config.spec.ts` |

**Dependencies:** none

**Acceptance criteria:**

- `docker compose up -d` sobe `redis` e `minio` com status healthy; `docker compose exec redis redis-cli CONFIG GET maxmemory-policy` retorna `noeviction`
- `docker compose exec nestjs-api ffprobe -version` e `docker compose exec nestjs-api ffmpeg -version` executam com sucesso após rebuild da imagem
- A aplicação inicia sem `STORAGE_ACCESS_KEY` → falha de validação Joi no bootstrap (não sobe)
- No host, a API do MinIO responde em `http://localhost:${MINIO_API_HOST_PORT}/minio/health/live` com 200 e o console em `http://localhost:${MINIO_CONSOLE_HOST_PORT}`, com as portas vindas do `.env`
- A suíte e2e existente (`GET /`, auth) continua passando com os novos serviços no Compose

---

### SI-03.2 — StorageModule: clientes S3 (interno + público), bootstrap de buckets e operações multipart

**Description:** Encapsula todo acesso ao armazenamento de arquivos num `StorageService` portável para qualquer backend S3-compatível, com dois clientes (endpoint interno para chamadas servidor→storage e endpoint público apenas para assinar URLs do navegador) e criação idempotente dos buckets na inicialização.

**Technical actions:**

1. Criar `src/storage/storage.constants.ts` — `enum StorageBucket { Videos = 'videos', Thumbnails = 'thumbnails' }` (nomes lógicos, resolvidos para `storage.videosBucket`/`storage.thumbnailsBucket`) e os tokens de injeção `S3_INTERNAL_CLIENT` / `S3_PUBLIC_CLIENT` (per `phase-03-videos/TD-05`).
2. Criar `src/storage/storage.module.ts` — `StorageModule` com dois providers `S3Client` via `useFactory` + `inject: [storageConfig.KEY]`: interno (`endpoint: storage.endpoint`) e público (`endpoint: storage.publicEndpoint`, usado só para presign — assinatura é offline); ambos com `region`, `credentials`, `forcePathStyle: true` e, se o context7 confirmar o comportamento da versão instalada, `requestChecksumCalculation: 'WHEN_REQUIRED'` / `responseChecksumValidation: 'WHEN_REQUIRED'`; exporta só `StorageService` (per `phase-03-videos/TD-02`, `phase-03-videos/TD-04`).
3. Criar `src/storage/storage.service.ts` — `StorageService implements OnModuleInit`: `onModuleInit()` garante os dois buckets (`HeadBucketCommand` → `CreateBucketCommand` se ausente; idempotente) (per `phase-03-videos/TD-02` revisão 2026-11-26); operações multipart no bucket de vídeos: `createMultipartUpload(key, contentType): Promise<string>`, `presignUploadPart(key, uploadId, partNumber): Promise<string>` (cliente **público**, `expiresIn: PRESIGNED_URL_TTL_SECONDS`), `listParts(key, uploadId): Promise<{ partNumber: number; etag: string; size: number }[]>` (paginando por `PartNumberMarker` até `IsTruncated = false`), `completeMultipartUpload(key, uploadId, parts)` (per `phase-03-videos/TD-03`).
4. Acrescentar em `StorageService`: `presignInternalGet(bucket, key)` (cliente **interno**, para o FFmpeg — per `phase-03-videos/TD-09`), `presignPublicGet(bucket, key, options?: { downloadFilename?: string })` (cliente **público**; com `downloadFilename` monta `ResponseContentDisposition: attachment; filename="..."; filename*=UTF-8''...` conforme RFC 6266 — per `phase-03-videos/TD-11`) e `putObject(bucket, key, body: Buffer, contentType)`; todo presign passa `expiresIn: 3600` explicitamente.
5. Não registrar `StorageModule` no `AppModule` ainda (entra com `VideosModule` na SI-03.4) — evita bootstrap de buckets sem consumidor.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `StorageService` | Integration (MinIO real do Compose): buckets criados no init e init idempotente; multipart completo com 2 partes (1ª ≥ 5 MiB) enviadas por `fetch` PUT nos URLs pré-assinados; `listParts` retorna partes e tamanhos; `putObject` + `presignInternalGet` baixa o conteúdo; `presignPublicGet` com `downloadFilename` gera `response-content-disposition` | `src/storage/storage.service.integration-spec.ts` |
| `StorageModule` | Unit: compilação com `storageConfig` e os dois clientes | `src/storage/storage.module.spec.ts` |

O integration spec roda dentro do container `nestjs-api`; para que os PUTs alcancem o MinIO, o teste instancia o módulo com `STORAGE_PUBLIC_ENDPOINT` igual a `STORAGE_ENDPOINT`.

**Dependencies:** SI-03.1 — pacotes AWS SDK, serviço `minio` e `storageConfig`

**Acceptance criteria:**

- Inicializar o `StorageModule` contra um MinIO vazio cria os buckets `videos` e `thumbnails`; inicializar de novo não gera erro nem duplica buckets
- Um URL de `presignUploadPart` contém o host de `STORAGE_PUBLIC_ENDPOINT`, `X-Amz-Expires=3600` e aceita um `PUT` do corpo da parte, devolvendo `ETag`
- Após enviar as partes, `listParts` lista exatamente os números/tamanhos enviados e `completeMultipartUpload` gera um objeto `{videoId}/original` com tamanho igual à soma das partes
- Um URL de `presignInternalGet` usa o host de `STORAGE_ENDPOINT` (rede do Compose) e baixa o objeto
- Um URL de `presignPublicGet` com `downloadFilename: "aula 1 – introdução.mp4"` responde com `Content-Disposition: attachment` contendo o nome codificado

---

### SI-03.3 — Entidade Video e migração CreateVideos

**Description:** Cria a entidade `Video` (status único `draft → processing → ready | failed`, `public_id` único, chaves de objeto e metadados do ffprobe), a relação inversa em `Channel` e a migração gerada pela CLI do TypeORM.

**Technical actions:**

1. Criar `src/videos/entities/video.entity.ts` — `@Entity('videos')` com as colunas exatamente como em `### Data Model → Video`: `status` como `enum` `video_status` (`enumName: 'video_status'`, default `'draft'`) (per `phase-03-videos/TD-06`); `public_id` `varchar(11)` unique (per `phase-03-videos/TD-10`); `size_bytes` `bigint` e `duration_seconds` `numeric(10,3)` com `transformer` string→number; `metadata` `jsonb` tipado por uma interface `VideoMetadata` (`width`, `height`, `videoCodec`, `audioCodec: string | null`, `formatName`, `bitRate`, `frameRate`, `sizeBytes`); `@ManyToOne(() => Channel, (channel) => channel.videos, { onDelete: 'CASCADE' })` + `@JoinColumn({ name: 'channel_id' })` e `@Index()` em `channel_id`. Exportar `enum VideoStatus`.
2. Atualizar `src/channels/entities/channel.entity.ts` — `@OneToMany(() => Video, (video) => video.channel) videos: Video[]`.
3. Gerar a migração com `npm run migration:generate -- src/database/migrations/CreateVideos` (arquivo `<timestamp>-CreateVideos.ts`) e revisar o SQL: tipo `video_status`, FK com `ON DELETE CASCADE`, unique em `public_id`, índice em `channel_id`, `down()` removendo tabela e tipo.
4. Atualizar `src/database/migrations.integration-spec.ts` (incluir `CreateVideos<timestamp>` na lista e a tabela `videos` nas asserções de apply/revert) e `cleanAllTables` em `src/test/create-test-data-source.ts` (`DELETE FROM "videos"` antes de `channels`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `Video` | Integration: `public_id` único; `status` default `draft` e enum rejeita valor fora da lista; nullables (`upload_id`, `thumbnail_key`, `duration_seconds`, `metadata`, `failure_reason`, `processed_at`); `size_bytes` > 2^32 volta como `number`; cascade ao apagar o canal | `src/videos/entities/video.entity.integration-spec.ts` |
| Migrações | Integration: apply/revert incluindo `CreateVideos` | `src/database/migrations.integration-spec.ts` |

**Dependencies:** none _(independente de SI-03.1/SI-03.2; pode correr em paralelo)_

**Acceptance criteria:**

- `npm run migration:run` cria a tabela `videos` com todas as colunas do Data Model, o tipo `video_status`, unique em `public_id` e índice em `channel_id`; `npm run migration:revert` remove tabela e tipo
- Inserir dois vídeos com o mesmo `public_id` falha com violação de unicidade (código `23505`)
- Um vídeo recém-inserido sem `status` explícito fica com `status = 'draft'`
- Inserir `status = 'published'` é rejeitado pelo enum
- Apagar um canal apaga seus vídeos (`ON DELETE CASCADE`)
- Um vídeo salvo com `size_bytes = 10737418240` é lido de volta como o número `10737418240`

---

### SI-03.4 — VideosModule: public_id, pré-cadastro em rascunho e leitura do dono

**Description:** Implementa a regra de negócio da iniciação do upload — resolve o canal do usuário, abre o multipart no storage e pré-cadastra o vídeo como `draft` com `public_id` único — e a busca de vídeo restrita ao dono, base de todas as rotas `/channels/me/videos`.

**Technical actions:**

1. Criar `src/videos/public-id.util.ts` — `generatePublicId(): string` com 11 caracteres do alfabeto base62 usando `randomInt(62)` de `node:crypto` por caractere (sem viés de módulo) (per `phase-03-videos/TD-10`); criar `src/videos/videos.constants.ts` com as constantes de `### Data Model → Upload constants`.
2. Criar `src/videos/videos.exceptions.ts` — `VideoNotFoundException` (`VIDEO_NOT_FOUND`, 404), `VideoNotUploadableException` (`VIDEO_NOT_UPLOADABLE`, 409), `InvalidPartNumberException` (`INVALID_PART_NUMBER`, 400), `UploadIncompleteException` (`UPLOAD_INCOMPLETE`, 409), todas estendendo `DomainException` com as mensagens do `### Error Catalog` (per `phase-02-auth/TD-07`).
3. Acrescentar `findByUserId(userId: string): Promise<Channel | null>` em `ChannelsService` — a resolução "usuário → canal" fica no domínio de canais (Single Responsibility).
4. Criar `src/videos/videos.service.ts` — `VideosService` com `initiateUpload(userId, input)`: resolve o canal; gera `id = randomUUID()` antes do insert para montar `video_key = {id}/original` (per `phase-03-videos/TD-05`); `storage.createMultipartUpload(video_key, content_type)` → `upload_id` (per `phase-03-videos/TD-03`); salva o `Video` (`status: 'draft'`, `title` default = `filename` sem extensão, truncado a 100) com `public_id = generatePublicId()`, repetindo até 5 vezes em violação `23505` na coluna `public_id`; retorna o vídeo + `{ part_size_bytes, part_count: ceil(size_bytes / UPLOAD_PART_SIZE_BYTES), max_parts_per_request }`. E `findOwnedVideo(userId, id)`: busca por `{ id, channel_id: <canal do usuário> }`; ausente → `VideoNotFoundException` (não revela vídeos de outros canais).
5. Criar `src/videos/videos.module.ts` — `VideosModule` importando `TypeOrmModule.forFeature([Video])`, `ChannelsModule` e `StorageModule`; provider `VideosService`; registrar `VideosModule` no `AppModule`.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `generatePublicId` | Unit: tamanho 11, só `[A-Za-z0-9]`, 10k chamadas sem repetição | `src/videos/public-id.util.spec.ts` |
| `VideosService` | Unit (repo/storage mockados): retry em colisão de `public_id` e desistência após 5; erro `23505` em outra coluna é relançado; `title` default; `part_count` para 1 byte, 64 MiB exatos e 10 GiB; `findOwnedVideo` lança `VideoNotFoundException` | `src/videos/videos.service.spec.ts` |
| `VideosService` | Integration (DB + MinIO): `initiateUpload` persiste `draft` com `upload_id` válido no MinIO e `video_key = {id}/original`; `findOwnedVideo` de outro usuário lança 404 | `src/videos/videos.service.integration-spec.ts` |
| `ChannelsService.findByUserId` | Integration: retorna o canal do usuário e `null` para usuário sem canal | `src/channels/channels.service.integration-spec.ts` |
| `VideosModule` | Unit: compilação com `TypeOrmModule.forFeature`, `ChannelsModule`, `StorageModule` | `src/videos/videos.module.spec.ts` |

**Dependencies:** SI-03.2 (StorageService), SI-03.3 (entidade Video)

**Acceptance criteria:**

- `initiateUpload` para um usuário com canal cria uma linha em `videos` com `status = 'draft'`, `channel_id` do canal do usuário, `public_id` de 11 caracteres base62 e `upload_id` aceito por `ListParts` no MinIO
- Duas iniciações seguidas geram `public_id` diferentes e `id`s diferentes
- `initiateUpload` com `size_bytes = 67108865` informa `part_count = 2`; com `10737418240` informa `part_count = 160`
- `initiateUpload` sem `title` usa o nome do arquivo sem extensão (`"aula-1.mp4"` → `"aula-1"`)
- `findOwnedVideo` com o `id` de um vídeo de outro canal lança `VIDEO_NOT_FOUND`, igual a um `id` inexistente

---

### SI-03.5 — Endpoints do dono: iniciar upload e consultar vídeo

**Description:** Expõe `POST /channels/me/videos` (inicia upload + rascunho) e `GET /channels/me/videos/:id` (leitura do dono em qualquer status) com DTOs validados e documentação OpenAPI.

**Technical actions:**

1. Criar `src/videos/dto/initiate-video-upload.dto.ts` — `InitiateVideoUploadDto` (`filename`, `content_type`, `size_bytes`, `title?`) com as regras de `#### Validation Rules — Video upload` (per `phase-02-auth/TD-06`); criar `src/videos/dto/video-owner-response.dto.ts` (`VideoOwnerResponseDto`, campos de `VideoOwnerResponse`) e `src/videos/dto/initiate-video-upload-response.dto.ts` (`VideoOwnerResponseDto` + `upload: { part_size_bytes, part_count, max_parts_per_request }`), com uma função `toVideoOwnerResponse(video)` que serializa datas em ISO-8601.
2. Criar `src/videos/channel-videos.controller.ts` — `@Controller('channels/me/videos')`, `@SkipThrottle()` (per `phase-02-auth/TD-08`), `@ApiTags('videos')`, `@ApiBearerAuth('access-token')`; `@Post()` → `videosService.initiateUpload(user.sub, dto)` retornando 201 com o shape de `### API Contracts → POST /channels/me/videos`; `@Get(':id')` com `ParseUUIDPipe` → `videosService.findOwnedVideo(user.sub, id)` retornando 200 `VideoOwnerResponse`. Usuário via `@CurrentUser()`; autenticação pelo `JwtAuthGuard` global (per `phase-02-auth/TD-02`).
3. Decorar as duas rotas com `@ApiOperation`, `@ApiResponse` para 201/200, 400, 401, 404 (erros com `ApiErrorEnvelope`), `@ApiParam('id')`, `@ApiBody` (per `openapi-docs-nestjs/TD-01`); registrar o controller em `VideosModule`.
4. Criar `test/helpers/authenticated-user.ts` — cria um usuário confirmado com canal (via serviços da aplicação de teste) e devolve `{ userId, channelId, accessToken }`, para os e2e de vídeos.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `ChannelVideosController` (initiate + owner read) + `InitiateVideoUploadDto` | E2E: 201 com `status: 'draft'`, `public_id` e `upload.part_count`; 400 para `size_bytes` > 10 GiB, `content_type` não-vídeo e campo desconhecido; 401 sem token; `GET :id` 200 para o dono, 404 para outro usuário e `id` inexistente, 400 para `id` não-UUID | `test/videos.e2e-spec.ts` |

**Dependencies:** SI-03.4 — `VideosService`, exceções e `VideosModule`

**Acceptance criteria:**

- `POST /channels/me/videos` com `{ filename: "aula.mp4", content_type: "video/mp4", size_bytes: 1048576 }` e token válido retorna `201` com `status: "draft"`, `public_id` de 11 caracteres e `upload: { part_size_bytes: 67108864, part_count: 1, max_parts_per_request: 100 }`
- `POST /channels/me/videos` com `size_bytes: 10737418241` retorna `400` com `error: "VALIDATION_ERROR"` (AMB-3 (b))
- `POST /channels/me/videos` com `content_type: "image/png"` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST /channels/me/videos` sem `Authorization` retorna `401`
- `GET /channels/me/videos/:id` do próprio vídeo retorna `200` com `status: "draft"` e campos de processamento `null`
- `GET /channels/me/videos/:id` com o vídeo de outro usuário retorna `404` com `error: "VIDEO_NOT_FOUND"` — mesma resposta de um `id` inexistente
- O documento OpenAPI gerado por `npm run openapi:export` lista as duas rotas sob a tag `videos`, com o esquema de segurança `access-token` e respostas de erro tipadas por `ApiErrorEnvelope`

---

### SI-03.6 — Upload multipart: assinar partes e listar partes enviadas (retomada)

**Description:** Entrega o coração do upload de 10GB — o cliente pede URLs pré-assinados em lotes e envia cada parte de 64 MiB direto ao storage, e pode retomar um upload interrompido consultando as partes já armazenadas — sem nenhum byte de vídeo passando pela API.

**Technical actions:**

1. Acrescentar em `VideosService`: `signUploadParts(userId, id, partNumbers)` — `findOwnedVideo`; `status !== 'draft'` → `VideoNotUploadableException`; qualquer número > `part_count` → `InvalidPartNumberException`; para cada número, `storage.presignUploadPart(video_key, upload_id, n)`; retorna `{ parts: [{ part_number, url }], expires_at }` (per `phase-03-videos/TD-03`, `phase-03-videos/TD-04`). E `listUploadedParts(userId, id)` — mesmas guardas de dono/status; `storage.listParts(video_key, upload_id)` mapeado para `{ part_number, etag, size_bytes }` ordenado.
2. Criar `src/videos/dto/sign-upload-parts.dto.ts` (`SignUploadPartsDto.part_numbers` com as regras de `#### Validation Rules — Video upload`), `src/videos/dto/signed-upload-parts-response.dto.ts` e `src/videos/dto/uploaded-parts-response.dto.ts`.
3. Acrescentar em `ChannelVideosController`: `@Post(':id/upload-parts')` com `@HttpCode(200)` e `@Get(':id/upload-parts')`, ambos com `ParseUUIDPipe` e os shapes de `### API Contracts`; decorar com `@ApiOperation`, `@ApiResponse` (200, 400, 401, 404, 409), `@ApiParam`, `@ApiBody` (per `openapi-docs-nestjs/TD-01`).
4. Criar `test/setup-e2e-env.ts` e incluí-lo em `setupFiles` de `test/jest-e2e.json` (depois de `dotenv/config`) — força `STORAGE_PUBLIC_ENDPOINT = STORAGE_ENDPOINT` no processo de teste, porque o e2e roda dentro do container `nestjs-api` e precisa alcançar os URLs assinados pela rede do Compose (per `phase-03-videos/TD-04`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` (sign/list) | Unit (repo/storage mockados): `VIDEO_NOT_UPLOADABLE` para `processing`/`ready`/`failed`; `INVALID_PART_NUMBER` para número > `part_count`; mapeamento de `listParts` | `src/videos/videos.service.spec.ts` |
| `VideosService` (sign/list) | Integration (DB + MinIO): URL assinado aceita `PUT` real; `listUploadedParts` reflete a parte enviada | `src/videos/videos.service.integration-spec.ts` |
| `ChannelVideosController` (upload-parts) + `SignUploadPartsDto` | E2E: assina parte 1, faz `PUT` real no MinIO, lista a parte com `etag`; 400 para `part_numbers` vazio/duplicado/> 100 itens; 400 `INVALID_PART_NUMBER`; 404 para outro usuário; 409 para vídeo fora de `draft`; 401 sem token | `test/videos.e2e-spec.ts` |

**Dependencies:** SI-03.5 — controller do dono, DTO de resposta e helper de usuário autenticado

**Acceptance criteria:**

- `POST /channels/me/videos/:id/upload-parts` com `{ part_numbers: [1] }` em um vídeo `draft` retorna `200` com `parts[0].part_number = 1`, `parts[0].url` assinado (`X-Amz-Expires=3600`) e `expires_at` ~1h no futuro
- Um `PUT` do corpo da parte no `url` retornado responde `200` com `ETag` — o corpo nunca passa pela API
- `GET /channels/me/videos/:id/upload-parts` após esse `PUT` retorna `200` com `parts: [{ part_number: 1, etag, size_bytes }]`; antes de qualquer `PUT` retorna `parts: []`
- `POST .../upload-parts` com `{ part_numbers: [2] }` em um vídeo de `part_count = 1` retorna `400` com `error: "INVALID_PART_NUMBER"`
- `POST .../upload-parts` com `{ part_numbers: [1, 1] }` ou `[]` retorna `400` com `error: "VALIDATION_ERROR"`
- `POST .../upload-parts` em vídeo com `status = 'processing'` retorna `409` com `error: "VIDEO_NOT_UPLOADABLE"`
- `POST .../upload-parts` e `GET .../upload-parts` no vídeo de outro usuário retornam `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.7 — Conclusão do upload e enfileiramento do processamento

**Description:** Fecha o multipart no storage, move o vídeo para `processing` e publica o job `video-processing` com `jobId = videoId`, tornando o endpoint de conclusão o gatilho único, autorizado e idempotente do processamento.

**Technical actions:**

1. Registrar `BullModule.forRootAsync({ inject: [queueConfig.KEY], useFactory: (cfg) => ({ connection: { host: cfg.host, port: cfg.port } }) })` no `AppModule` e `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })` no `VideosModule` (per `phase-03-videos/TD-01`).
2. Criar `src/videos/video-processing.producer.ts` — `VideoProcessingProducer` com `@InjectQueue(VIDEO_PROCESSING_QUEUE)`; `enqueue(videoId)` faz `queue.add(VIDEO_PROCESSING_JOB, { videoId }, { jobId: videoId, attempts: 3, backoff: { type: 'exponential', delay: 5000 } })` (per `phase-03-videos/TD-07`, `phase-03-videos/TD-06`); provider do `VideosModule`. O processor **não** entra no `VideosModule` (fica no módulo do worker, SI-03.9).
3. Acrescentar `completeUpload(userId, id)` em `VideosService` — `findOwnedVideo`; `ready`/`failed` → `VideoNotUploadableException`; `processing` → apenas `producer.enqueue(id)` (deduplicado) e retorna; `draft` → `storage.listParts` e valida cobertura `1..part_count` e soma de tamanhos = `size_bytes` (senão `UploadIncompleteException`); `storage.completeMultipartUpload` com as partes ordenadas; `UPDATE ... SET status = 'processing', upload_id = NULL WHERE id = :id AND status = 'draft'`; `producer.enqueue(id)`. Em chamadas concorrentes, se o `CompleteMultipartUpload` falhar com `NoSuchUpload`, recarrega o vídeo e, se já estiver `processing`, segue o caminho idempotente.
4. Acrescentar em `ChannelVideosController` o `@Post(':id/upload-completion')` com `@HttpCode(202)`, `ParseUUIDPipe` e resposta `{ id, public_id, status }`; decorar com `@ApiOperation`, `@ApiResponse` (202, 400, 401, 404, 409), `@ApiParam` (per `openapi-docs-nestjs/TD-01`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProducer` | Integration (Redis real): job criado com `name = 'process'`, `data = { videoId }`, `opts.jobId = videoId`, `attempts = 3`, backoff exponencial 5000; segundo `enqueue` com o mesmo id não cria outro job | `src/videos/video-processing.producer.integration-spec.ts` |
| `VideosService.completeUpload` | Unit (repo/storage/producer mockados): `UPLOAD_INCOMPLETE` por parte faltando e por soma divergente; `processing` só reenfileira; `ready`/`failed` → `VIDEO_NOT_UPLOADABLE`; caminho `NoSuchUpload` concorrente | `src/videos/videos.service.spec.ts` |
| `VideosService.completeUpload` | Integration (DB + MinIO + Redis): objeto final existe com o tamanho declarado, `status = 'processing'`, `upload_id = null`, job na fila | `src/videos/videos.service.integration-spec.ts` |
| `VideosModule` | Unit: compilação com `BullModule.registerQueue` | `src/videos/videos.module.spec.ts` |
| `ChannelVideosController` (upload-completion) | E2E: upload real de 1 parte + `upload-completion` → 202 `processing`; repetir → 202; sem partes → 409 `UPLOAD_INCOMPLETE`; outro usuário → 404; 401 sem token | `test/videos.e2e-spec.ts` |

**Dependencies:** SI-03.6 — fluxo de assinatura/listagem de partes

**Acceptance criteria:**

- `POST /channels/me/videos/:id/upload-completion` após enviar todas as partes retorna `202` com `{ id, public_id, status: "processing" }` e o objeto `{id}/original` passa a existir no bucket `videos` com o tamanho declarado
- Após a conclusão, a fila `video-processing` contém um job com id igual ao `id` do vídeo e payload `{ videoId }`
- Repetir `POST .../upload-completion` com o vídeo em `processing` retorna `202` e a fila continua com um único job para esse vídeo
- `POST .../upload-completion` sem nenhuma parte enviada retorna `409` com `error: "UPLOAD_INCOMPLETE"` e o vídeo continua `draft`
- `POST .../upload-completion` em vídeo `ready` ou `failed` retorna `409` com `error: "VIDEO_NOT_UPLOADABLE"`
- `POST .../upload-completion` no vídeo de outro usuário retorna `404` com `error: "VIDEO_NOT_FOUND"`

---

### SI-03.8 — FfmpegService: extração de metadados (ffprobe) e thumbnail (ffmpeg)

**Description:** Isola a chamada aos binários `ffprobe`/`ffmpeg` num serviço testável que lê a entrada por URL (ou caminho) com range requests, devolve os metadados persistidos pela fase e gera um JPEG de um frame do vídeo.

**Technical actions:**

1. Criar `src/video-processing/ffmpeg.service.ts` — `FfmpegService.probe(input: string): Promise<{ durationSeconds: number; metadata: VideoMetadata }>` executando `ffprobe -v error -print_format json -show_format -show_streams <input>` via `execFile` de `node:child_process` (nunca string de shell; `fluent-ffmpeg` excluído) com `timeout` e `maxBuffer`; mapeia `format.duration`, `format.format_name`, `format.bit_rate`, `format.size`, stream de vídeo (`width`, `height`, `codec_name`, `avg_frame_rate` fração → número) e stream de áudio (`codec_name` ou `null`) para `VideoMetadata` (AMB-1) (per `phase-03-videos/TD-09`).
2. Em `FfmpegService.probe`, sem stream de vídeo ou JSON inválido → lançar `UnrecoverableError` do `bullmq` (entrada não-retentável — per `phase-03-videos/TD-06`); falha de processo/timeout → `Error` comum (retentável).
3. Acrescentar `FfmpegService.extractThumbnail(input: string, atSeconds: number): Promise<Buffer>` — `ffmpeg -v error -ss <atSeconds> -i <input> -frames:v 1 -q:v 2 -f image2 <tmp>.jpg` (seek no input = range request) num arquivo de `os.tmpdir()`, lê o buffer e remove o temporário em `finally` (per `phase-03-videos/TD-09`).
4. Gerar e commitar `nestjs-project/test/fixtures/sample.mp4` (~3 s, 320x240, H.264 + AAC) com `ffmpeg -f lavfi -i testsrc=duration=3:size=320x240:rate=25 -f lavfi -i sine=frequency=440:duration=3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest test/fixtures/sample.mp4`; documentar o comando num comentário do spec.

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `FfmpegService` | Integration (binários reais, fixture): `probe` retorna `durationSeconds ≈ 3`, `width 320`, `height 240`, `videoCodec 'h264'`, `audioCodec 'aac'`, `frameRate 25`; arquivo não-vídeo → `UnrecoverableError`; `extractThumbnail` devolve buffer iniciando com `FF D8` (JPEG) | `src/video-processing/ffmpeg.service.integration-spec.ts` |
| Parsing de `avg_frame_rate` / mapeamento | Unit: `30000/1001` → `29.97`, `0/0` → `0`, ausência de áudio → `audioCodec: null` | `src/video-processing/ffprobe-metadata.spec.ts` |

**Dependencies:** SI-03.1 — `ffmpeg`/`ffprobe` na imagem e pacote `bullmq` (`UnrecoverableError`); SI-03.3 — interface `VideoMetadata`

**Acceptance criteria:**

- `probe` sobre `test/fixtures/sample.mp4` retorna duração entre 2.9 e 3.1 s e `metadata` com `width: 320`, `height: 240`, `videoCodec: "h264"`, `audioCodec: "aac"`, `formatName` contendo `mp4`
- `probe` sobre um arquivo de texto lança `UnrecoverableError`
- `probe` sobre um vídeo sem trilha de áudio retorna `audioCodec: null`
- `extractThumbnail(sample, 1)` retorna um JPEG válido e não deixa arquivo temporário para trás
- Nenhuma chamada monta comando por string de shell (nome de arquivo com espaço/aspas não quebra a execução)

---

### SI-03.9 — VideoProcessingProcessor: processamento do job, thumbnail e política de falha

**Description:** Implementa o consumidor da fila — busca o vídeo, extrai metadados e thumbnail lendo o original por URL pré-assinado interno, persiste o resultado e aplica a política de falha (retry com backoff; `failed` só na última tentativa) — num módulo exclusivo do worker.

**Technical actions:**

1. Acrescentar em `VideosService` (o domínio de vídeos continua dono da escrita na entidade): `findById(id): Promise<Video | null>`, `markReady(id, { durationSeconds, metadata, thumbnailKey })` (`status = 'ready'`, `processed_at = now`, `failure_reason = null`) e `markFailed(id, reason)` (`status = 'failed'`, `failure_reason` truncado a 500); exportar `VideosService` no `VideosModule` (per `phase-03-videos/TD-06`).
2. Criar `src/video-processing/video-processing.processor.ts` — `@Processor(VIDEO_PROCESSING_QUEUE, { concurrency: 2 })` estendendo `WorkerHost`; `process(job)`: vídeo ausente → log + retorna; `ready` → retorna (idempotente); `storage.presignInternalGet(StorageBucket.Videos, video_key)` (per `phase-03-videos/TD-09`) → `ffmpeg.probe(url)` → `ffmpeg.extractThumbnail(url, min(1, duration / 2))` → `storage.putObject(StorageBucket.Thumbnails, '{videoId}/thumbnail.jpg', buffer, 'image/jpeg')` (per `phase-03-videos/TD-05`) → `videosService.markReady(...)` (per `phase-03-videos/TD-08`).
3. Acrescentar no processor `@OnWorkerEvent('failed') onFailed(job, error)` — chama `markFailed(videoId, error.message)` somente quando a tentativa é a final (`error` é `UnrecoverableError`, ou `job.attemptsMade >= (job.opts.attempts ?? 1)` — confirmar no context7 se `attemptsMade` já está incrementado no evento `failed` da versão instalada) (per `phase-03-videos/TD-06`); falhas intermediárias deixam `status = 'processing'`.
4. Criar `src/video-processing/video-processing.module.ts` — `VideoProcessingModule` (exclusivo do worker; **nunca** importado pelo `AppModule`) importando `VideosModule`, `StorageModule` e `BullModule.registerQueue({ name: VIDEO_PROCESSING_QUEUE })`; providers `FfmpegService` e `VideoProcessingProcessor` (per `phase-03-videos/TD-08`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideoProcessingProcessor` | Unit (serviços mockados): vídeo ausente/`ready` não chama ffmpeg; caminho feliz chama `markReady` com a chave da thumbnail; `onFailed` só marca `failed` na última tentativa ou com `UnrecoverableError`; seek = `min(1, duration/2)` | `src/video-processing/video-processing.processor.spec.ts` |
| `VideoProcessingProcessor` | Integration (DB + MinIO + ffmpeg real): fixture enviada ao bucket `videos`, `process()` chamado com um job fake → vídeo `ready` com `duration_seconds`, `metadata`, `thumbnail_key` e objeto JPEG no bucket `thumbnails`; arquivo inválido + `onFailed` final → `failed` com `failure_reason` | `src/video-processing/video-processing.processor.integration-spec.ts` |
| `VideosService` (markReady/markFailed) | Integration: colunas atualizadas e `failure_reason` truncado | `src/videos/videos.service.integration-spec.ts` |
| `VideoProcessingModule` | Unit: compilação com `VideosModule`, `StorageModule`, `BullModule.registerQueue` | `src/video-processing/video-processing.module.spec.ts` |

**Dependencies:** SI-03.7 (fila registrada e `VideosModule` com Bull), SI-03.8 (`FfmpegService`)

**Acceptance criteria:**

- Processar o job de um vídeo `processing` cujo original é a fixture deixa o vídeo `ready`, com `duration_seconds ≈ 3`, `metadata.width = 320`, `processed_at` preenchido e `thumbnail_key = "{id}/thumbnail.jpg"`
- Após o processamento, o objeto `{id}/thumbnail.jpg` existe no bucket `thumbnails` com `Content-Type: image/jpeg`
- Processar de novo um vídeo já `ready` não altera `processed_at` nem regrava a thumbnail
- Um job cujo vídeo foi apagado termina sem erro e sem efeitos colaterais
- Um original que não é vídeo leva o vídeo a `failed` com `failure_reason` preenchido, sem novas tentativas
- Uma falha transitória na 1ª tentativa mantém `status = 'processing'`; a falha na 3ª tentativa leva a `failed`

---

### SI-03.10 — Runtime do worker: `worker.ts`, `WorkerModule` e serviço `video-worker`

**Description:** Sobe o processamento num container separado com o mesmo código-fonte — um application context Nest sem HTTP que só consome a fila — mantendo o FFmpeg fora do orçamento de CPU da API.

**Technical actions:**

1. Extrair as opções hoje inline no `AppModule` para fábricas reutilizáveis, sem mudar comportamento: `src/config/config-module.options.ts` (`configModuleOptions`: `isGlobal`, `load` com todos os namespaces, `validationSchema`, `validationOptions`), `src/database/typeorm-options.factory.ts` (fábrica a partir de `databaseConfig`) e `src/config/bull-root.options.ts` (fábrica de `connection` a partir de `queueConfig`); `AppModule` passa a usá-las (per `phase-01-configuracao-base/TD-03`, `phase-01-configuracao-base/TD-04`).
2. Criar `src/worker.module.ts` — `WorkerModule` com `ConfigModule.forRoot(configModuleOptions)`, `TypeOrmModule.forRootAsync(...)`, `BullModule.forRootAsync(...)` e `VideoProcessingModule` — sem controllers, sem `AuthModule` (per `phase-03-videos/TD-08`).
3. Criar `src/worker.ts` — `NestFactory.createApplicationContext(WorkerModule)`, `app.enableShutdownHooks()` (fecha o worker BullMQ no `SIGTERM`) e log `Video worker ready (queue: video-processing)`.
4. Criar `nestjs-project/tsconfig.worker.json` (estende `tsconfig.build.json` com `outDir: ./dist-worker`, para o watch do worker não apagar/competir com o `dist/` da API — `deleteOutDir: true` no `nest-cli.json`); scripts `start:worker:dev` (`nest start --watch --entryFile worker --path tsconfig.worker.json`) e `start:worker:prod` (`node dist/worker`); `/dist-worker` no `.gitignore` e no `exclude` dos tsconfigs. Confirmar no context7 o uso de `--entryFile`/`--path` do Nest CLI instalado.
5. Acrescentar em `nestjs-project/compose.yaml` o serviço `video-worker` — mesmo `build` (`Dockerfile.dev`) e mesmo volume do `nestjs-api`, `command: npm run start:worker:dev`, `depends_on` `db`/`redis`/`minio` com `service_healthy`, sem portas publicadas (per `phase-03-videos/TD-08`).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `WorkerModule` | Unit: compilação e ausência de controllers HTTP; `VideoProcessingProcessor` resolvível | `src/worker.module.spec.ts` |
| `AppModule` | Unit: `VideoProcessingProcessor` **não** é resolvível no contexto da API | `src/app.module.spec.ts` |
| Fábricas extraídas | Unit: `typeOrmOptionsFactory` e `bullRootOptionsFactory` mapeiam a config para as opções esperadas | `src/database/typeorm-options.factory.spec.ts`, `src/config/bull-root.options.spec.ts` |

**Dependencies:** SI-03.9 — `VideoProcessingModule`

**Acceptance criteria:**

- `docker compose up -d video-worker` sobe o container e `docker compose logs video-worker` mostra `Video worker ready (queue: video-processing)`
- Com `video-worker` rodando, um vídeo concluído via `upload-completion` chega a `status = 'ready'` em poucos segundos (fixture de ~3 s), visível em `GET /channels/me/videos/:id`
- Com `video-worker` parado, um vídeo concluído permanece `processing` e o job continua na fila — a API não consome jobs
- `docker compose stop video-worker` encerra o processo em menos de 10 s (shutdown hooks fecham o worker)
- `npm run build` gera `dist/main.js` e `dist/worker.js`; `npm run start:dev` (API) e `start:worker:dev` rodam juntos sem um apagar o build do outro

---

### SI-03.11 — Entrega pública: detalhes, streaming, download e thumbnail por `public_id`

**Description:** Expõe as rotas anônimas keyed por `public_id` — detalhes e redirecionamentos 302 para URLs pré-assinados do storage (streaming por Range nativo, download com `Content-Disposition`, thumbnail) — servindo apenas vídeos `ready`, e cobre o fluxo ponta a ponta com o worker real.

**Technical actions:**

1. Acrescentar em `VideosService`: `findReadyByPublicId(publicId)` — id fora de `^[A-Za-z0-9]{11}$`, inexistente ou com `status != 'ready'` → `VideoNotFoundException` (AMB-2), carregando `channel` (`nickname`, `name`); `getStreamUrl(publicId)` → `storage.presignPublicGet(StorageBucket.Videos, video_key)`; `getDownloadUrl(publicId)` → mesmo com `downloadFilename: original_filename`; `getThumbnailUrl(publicId)` → `presignPublicGet(StorageBucket.Thumbnails, thumbnail_key)` (null → `VideoNotFoundException`) (per `phase-03-videos/TD-10`, `phase-03-videos/TD-11`).
2. Criar `src/videos/dto/public-video-response.dto.ts` — `PublicVideoResponseDto` com o shape de `### API Contracts → GET /videos/:publicId` (`stream_url`, `download_url`, `thumbnail_url` como caminhos da API).
3. Criar `src/videos/public-videos.controller.ts` — `@Controller('videos')`, `@Public()`, `@SkipThrottle()`, `@ApiTags('videos')`; `@Get(':publicId')` → 200; `@Get(':publicId/stream')`, `@Get(':publicId/download')`, `@Get(':publicId/thumbnail')` → `302` com `Location` = URL pré-assinado (TTL 3600 s) e `Cache-Control: no-store`; registrar em `VideosModule`.
4. Decorar com `@ApiOperation`, `@ApiParam('publicId')`, `@ApiResponse` 200/302 (header `Location`) e 404 com `ApiErrorEnvelope` (per `openapi-docs-nestjs/TD-01`).
5. Criar `test/videos-processing.e2e-spec.ts` — fluxo completo com o container `video-worker` rodando: iniciar com o tamanho de `test/fixtures/sample.mp4` → assinar parte 1 → `PUT` real da fixture no MinIO → `upload-completion` → polling de `GET /channels/me/videos/:id` até `ready` (timeout 60 s) → rotas públicas; seguir cada `Location` com `fetch` (alcançável pelo override de `STORAGE_PUBLIC_ENDPOINT` da SI-03.6).

**Tests:**

| Artifact | Layer | Test file |
|----------|-------|-----------|
| `VideosService` (público) | Unit (repo/storage mockados): 404 para id malformado, inexistente, `draft`/`processing`/`failed`, thumbnail nula; download passa `downloadFilename` | `src/videos/videos.service.spec.ts` |
| `PublicVideosController` | E2E: 404 `VIDEO_NOT_FOUND` em todas as rotas públicas para vídeo `draft`/`processing` e `public_id` inexistente/malformado; anônimo não recebe 401 | `test/videos.e2e-spec.ts` |
| Fluxo upload → worker → entrega | E2E (MinIO + Redis + `video-worker` reais): status `ready` com metadados; detalhes 200; `stream` 302 cujo `Location` responde `206` a `Range: bytes=0-99`; `download` 302 cujo `Location` responde com `Content-Disposition: attachment`; `thumbnail` 302 cujo `Location` responde `image/jpeg` | `test/videos-processing.e2e-spec.ts` |

**Dependencies:** SI-03.10 — worker em execução para o fluxo ponta a ponta (o controller em si depende só de SI-03.7)

**Acceptance criteria:**

- `GET /videos/:publicId` de um vídeo `ready`, sem `Authorization`, retorna `200` com `title`, `duration_seconds`, `metadata`, `channel.nickname` e `stream_url = "/videos/{publicId}/stream"`
- `GET /videos/:publicId/stream` retorna `302` com `Location` no host de `STORAGE_PUBLIC_ENDPOINT`; um `GET` nesse `Location` com `Range: bytes=0-99` responde `206` com 100 bytes
- `GET /videos/:publicId/download` retorna `302`; o `Location` responde com `Content-Disposition: attachment` contendo o `original_filename`
- `GET /videos/:publicId/thumbnail` retorna `302`; o `Location` responde `200` com `Content-Type: image/jpeg`
- Qualquer rota pública para um vídeo `draft`, `processing` ou `failed` retorna `404` com `error: "VIDEO_NOT_FOUND"` — mesma resposta de um `public_id` inexistente
- `GET /videos/abc` (`public_id` malformado) retorna `404` com `error: "VIDEO_NOT_FOUND"`
- Dois vídeos enviados pelo mesmo canal com o mesmo arquivo recebem `public_id` distintos e cada URL pública entrega o próprio vídeo

---

### SI-03.12 — Documentação: CLAUDE.md, api.http, openapi.json e verificação manual de 1GB

**Description:** Atualiza a documentação operacional e o contrato exportado com o módulo de vídeos, a fila/worker e o storage, e registra a verificação manual do critério "10GB sem impacto na performance".

**Technical actions:**

1. Atualizar `nestjs-project/CLAUDE.md` — serviços `redis`, `minio` e `video-worker` (portas por env, checagens de prontidão: `docker compose exec redis redis-cli ping` → `PONG`, `curl http://localhost:${MINIO_API_HOST_PORT}/minio/health/live` → 200, `docker compose logs video-worker`); seção de vídeos (módulos `storage`/`videos`/`video-processing`, endpoints, fila `video-processing`, worker `src/worker.ts`, scripts `start:worker:dev`/`start:worker:prod`, buckets e chaves, `STORAGE_PUBLIC_ENDPOINT` vs `STORAGE_ENDPOINT`, override no e2e, e2e de processamento exige `video-worker` rodando).
2. Atualizar o `CLAUDE.md` da raiz — containers da arquitetura agora concretos: Message Queue = Redis + BullMQ, Object Storage = MinIO (`pgsty/minio`), Video Worker = serviço `video-worker` do mesmo codebase (per `phase-03-videos/TD-01`, `phase-03-videos/TD-02`, `phase-03-videos/TD-08`).
3. Acrescentar seção de vídeos em `nestjs-project/api.http` — initiate, owner read, sign parts, list parts, completion e as quatro rotas públicas, com variáveis para token, `id` e `public_id`.
4. Reexportar `nestjs-project/openapi.json` com `npm run openapi:export` e conferir as 9 rotas novas, os DTOs e os erros tipados (per `openapi-docs-nestjs/TD-02`).
5. Executar e registrar no `nestjs-project/CLAUDE.md` (seção de vídeos) o roteiro manual de AMB-3 (c): upload de um arquivo ≥ 1 GB em partes de 64 MiB direto no MinIO (via `api.http` + `curl --upload-file` por parte) enquanto `GET /` e `GET /channels/me/videos/:id` seguem respondendo.

**Tests:** _(empty — documentação e contrato exportado; `src/openapi-export.integration-spec.ts` existente continua cobrindo a exportação)_

**Dependencies:** SI-03.11 — todas as rotas e o worker prontos

**Acceptance criteria:**

- `nestjs-project/openapi.json` contém `POST /channels/me/videos`, `GET /channels/me/videos/{id}`, `POST`/`GET /channels/me/videos/{id}/upload-parts`, `POST /channels/me/videos/{id}/upload-completion` e `GET /videos/{publicId}` (+ `/stream`, `/download`, `/thumbnail`)
- Seguindo apenas o `nestjs-project/CLAUDE.md`, um desenvolvedor sobe `redis`, `minio` e `video-worker` e confirma a prontidão de cada um
- Cada requisição da seção de vídeos do `api.http`, executada em ordem, produz a resposta descrita em `### API Contracts`
- O upload manual de um arquivo ≥ 1 GB conclui com o vídeo `ready`, sem que a API receba bytes do vídeo e com `GET /` respondendo durante todo o upload

---

## Technical Specifications

### Data Model

#### Video

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK, generated | Internal identifier; used as `jobId` and as the object-key prefix (`phase-03-videos/TD-05`, `phase-03-videos/TD-07`) |
| channel_id | uuid | FK → channels.id, not null, `ON DELETE CASCADE` | Owning channel (the uploader's channel) |
| public_id | varchar(11) | unique, not null | Random 11-char base62 public identifier, generated with `node:crypto` (`phase-03-videos/TD-10`) |
| title | varchar(100) | not null | Defaults to `original_filename` without extension (truncated to 100) when not sent at initiation |
| original_filename | varchar(255) | not null | As sent by the client; used in the download `Content-Disposition` |
| content_type | varchar(100) | not null | Must start with `video/`; passed to `CreateMultipartUpload` |
| size_bytes | bigint | not null | Declared size, 1..10737418240 (10 GiB); TypeORM transformer maps to `number` |
| status | enum `video_status` | not null, default `'draft'`, values: `'draft'`, `'processing'`, `'ready'`, `'failed'` | Single combined status (`phase-03-videos/TD-06`) |
| upload_id | varchar | nullable | S3 multipart `UploadId`; set at initiation, cleared (`null`) after `CompleteMultipartUpload` |
| video_key | varchar | not null | Object key in the videos bucket: `{videoId}/original` (`phase-03-videos/TD-05`) |
| thumbnail_key | varchar | nullable | Object key in the thumbnails bucket: `{videoId}/thumbnail.jpg`; set by the worker |
| duration_seconds | numeric(10,3) | nullable | From ffprobe `format.duration`; transformer maps to `number` |
| metadata | jsonb | nullable | `{ width, height, videoCodec, audioCodec (nullable), formatName, bitRate, frameRate, sizeBytes }` from ffprobe (AMB-1) |
| failure_reason | text | nullable | Last processing error message (truncated to 500 chars) when `status = 'failed'` |
| processed_at | timestamp | nullable | Set when processing finishes successfully |
| created_at | timestamp | not null, auto-generated | `@CreateDateColumn` |
| updated_at | timestamp | not null, auto-generated | `@UpdateDateColumn` |

**Relations:** Video → Channel (many-to-one, owning side via `channel_id`, `onDelete: 'CASCADE'`); Channel → Video (one-to-many inverse `videos`)
**Indexes:** `(public_id)` — unique, `(channel_id)` — FK lookup

**Status lifecycle** (`phase-03-videos/TD-06`): `draft` (created at initiation) → `processing` (after `upload-completion`) → `ready` (worker success) | `failed` (worker final failure — after the last retry, or immediately on `UnrecoverableError`). Publication/visibility is **not** part of this enum — Phase 04 adds it as a separate column.

#### Storage layout (object storage — not a DB table)

| Bucket (env) | Default name | Object key | Content | Access |
|--------------|--------------|------------|---------|--------|
| `STORAGE_VIDEOS_BUCKET` | `videos` | `{videoId}/original` | Uploaded original (multipart) | Private; presigned `UploadPart` (upload) and presigned `GetObject` (stream/download/ffmpeg) |
| `STORAGE_THUMBNAILS_BUCKET` | `thumbnails` | `{videoId}/thumbnail.jpg` | JPEG frame generated by the worker | Private in Phase 03; served via presigned `GetObject` |

Buckets are created idempotently by the API at startup (`HeadBucket` → `CreateBucket`) — no `mc` sidecar (`phase-03-videos/TD-02` revision 2026-11-26).

#### Upload constants (`src/videos/videos.constants.ts`)

| Constant | Value | Source |
|----------|-------|--------|
| `MAX_VIDEO_SIZE_BYTES` | `10 * 1024 ** 3` (10 GiB) | `phase-03-videos/TD-03`, AMB-3 (b) |
| `UPLOAD_PART_SIZE_BYTES` | `64 * 1024 ** 2` (64 MiB) | `phase-03-videos/TD-03` |
| `MAX_PARTS_PER_SIGN_REQUEST` | `100` | Batch cap for `upload-parts` signing |
| `PRESIGNED_URL_TTL_SECONDS` | `3600` | `phase-03-videos/TD-03`, `TD-09`, `TD-11` (presigner default 900 s is never used) |
| `VIDEO_PROCESSING_QUEUE` | `'video-processing'` | `phase-03-videos/TD-01` |
| `VIDEO_PROCESSING_JOB` | `'process'` | `phase-03-videos/TD-07` |

### API Contracts

All routes below are new. Owner routes live under the caller's channel (`/channels/me/...`) and require the access token (global `JwtAuthGuard`); public routes are keyed by `public_id` and carry `@Public()`. No endpoint accepts video bytes — upload bodies go only to presigned storage URLs (`phase-03-videos/TD-03`, AMB-3 (a)). Wire fields are snake_case, as in phase 02. Every controller carries the OpenAPI decorators per the inherited convention (`openapi-docs-nestjs/TD-01`): `@ApiTags`, `@ApiOperation`, `@ApiResponse` per status (errors typed with `ApiErrorEnvelope`), `@ApiParam`/`@ApiBody`, and `@ApiBearerAuth('access-token')` on owner routes.

**Shared shape — `VideoOwnerResponse`** (owner routes):
- id: string (uuid)
- public_id: string (11 chars, base62)
- title: string
- original_filename: string
- content_type: string
- size_bytes: number
- status: `'draft' | 'processing' | 'ready' | 'failed'`
- duration_seconds: number | null
- metadata: `{ width, height, videoCodec, audioCodec, formatName, bitRate, frameRate, sizeBytes }` | null
- failure_reason: string | null
- processed_at: string (ISO-8601) | null
- created_at: string (ISO-8601)
- updated_at: string (ISO-8601)

---

#### POST /channels/me/videos (SI-03.5)

Initiates the multipart upload and pre-registers the video as `draft` (`phase-03-videos/TD-03`, `phase-03-videos/TD-06`, `phase-03-videos/TD-10`).

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request body:**
- filename: string, required — 1..255 characters
- content_type: string, required — must match `^video\/[a-z0-9.+-]+$`
- size_bytes: integer, required — min 1, max 10737418240 (10 GiB)
- title: string, optional — 1..100 characters; defaults to `filename` without extension

**Response 201:**
- all `VideoOwnerResponse` fields (`status: 'draft'`, processing fields `null`)
- upload: object
  - part_size_bytes: number — `67108864` (64 MiB)
  - part_count: number — `ceil(size_bytes / part_size_bytes)`
  - max_parts_per_request: number — `100`

**Error responses:**
- 400 validation error: body fails schema validation, including `size_bytes` > 10 GiB or a non-`video/*` `content_type`
- 401: when the access token is missing or invalid

---

#### GET /channels/me/videos/:id (SI-03.5)

Owner read of their own video in any status (AMB-2).

**Request headers:**
- Authorization: Bearer <access_token>

**Request path parameters:**
- id: string (uuid), required

**Response 200:** `VideoOwnerResponse`

**Error responses:**
- 400 validation error: `id` is not a valid UUID
- 401: when the access token is missing or invalid
- 404 VIDEO_NOT_FOUND: no video with this `id`, or it belongs to another channel (existence is not revealed)

---

#### POST /channels/me/videos/:id/upload-parts (SI-03.6)

Signs a batch of part numbers with the **public** storage client (`phase-03-videos/TD-03`, `phase-03-videos/TD-04`). The client then `PUT`s each 64 MiB chunk straight to the returned URL.

**Request headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request path parameters:**
- id: string (uuid), required

**Request body:**
- part_numbers: integer[], required — 1..100 items, unique, each 1..10000

**Response 200:**
- parts: array of
  - part_number: number
  - url: string — presigned `UploadPart` URL on `STORAGE_PUBLIC_ENDPOINT`, TTL 3600 s
- expires_at: string (ISO-8601) — now + 3600 s

**Error responses:**
- 400 validation error: body fails schema validation
- 400 INVALID_PART_NUMBER: any `part_numbers` item is greater than the video's `part_count`
- 401: when the access token is missing or invalid
- 404 VIDEO_NOT_FOUND: unknown `id` or another channel's video
- 409 VIDEO_NOT_UPLOADABLE: video `status` is not `draft`

---

#### GET /channels/me/videos/:id/upload-parts (SI-03.6)

Lists the parts already stored, for resume (`ListParts`, paginated server-side until exhausted — `phase-03-videos/TD-03`).

**Request headers:**
- Authorization: Bearer <access_token>

**Request path parameters:**
- id: string (uuid), required

**Response 200:**
- parts: array of (ordered by `part_number`)
  - part_number: number
  - etag: string
  - size_bytes: number

**Error responses:**
- 400 validation error: `id` is not a valid UUID
- 401: when the access token is missing or invalid
- 404 VIDEO_NOT_FOUND: unknown `id` or another channel's video
- 409 VIDEO_NOT_UPLOADABLE: video `status` is not `draft`

---

#### POST /channels/me/videos/:id/upload-completion (SI-03.7)

Completes the multipart upload and enqueues processing (`phase-03-videos/TD-07`). The server builds the `CompleteMultipartUpload` part list from `ListParts` (the browser does not need to read `ETag` headers). Idempotent: a repeated call while `status = 'processing'` re-adds the job with `jobId = videoId` (deduplicated by the queue) and answers 202 again.

**Request headers:**
- Authorization: Bearer <access_token>

**Request path parameters:**
- id: string (uuid), required

**Request body:** none

**Response 202:**
- id: string (uuid)
- public_id: string
- status: `'processing'`

**Error responses:**
- 400 validation error: `id` is not a valid UUID
- 401: when the access token is missing or invalid
- 404 VIDEO_NOT_FOUND: unknown `id` or another channel's video
- 409 UPLOAD_INCOMPLETE: stored parts do not cover `1..part_count`, or their summed size differs from `size_bytes`
- 409 VIDEO_NOT_UPLOADABLE: video `status` is `ready` or `failed`

---

#### GET /videos/:publicId (SI-03.11)

Public details; serves only `status = 'ready'` (AMB-2).

**Request path parameters:**
- publicId: string, required — 11-char base62

**Response 200:**
- public_id: string
- title: string
- duration_seconds: number
- metadata: `{ width, height, videoCodec, audioCodec, formatName, bitRate, frameRate, sizeBytes }`
- channel: `{ nickname: string, name: string }`
- stream_url: string — `/videos/{publicId}/stream`
- download_url: string — `/videos/{publicId}/download`
- thumbnail_url: string — `/videos/{publicId}/thumbnail`
- created_at: string (ISO-8601)
- processed_at: string (ISO-8601)

**Error responses:**
- 404 VIDEO_NOT_FOUND: no video with this `public_id` (including malformed ids), or its `status` is not `ready`

---

#### GET /videos/:publicId/stream (SI-03.11)

Streaming via native HTTP Range against storage (`phase-03-videos/TD-11`).

**Request path parameters:**
- publicId: string, required

**Response 302:**
- Location: presigned `GetObject` URL (videos bucket, `video_key`) on `STORAGE_PUBLIC_ENDPOINT`, TTL 3600 s, no `Content-Disposition` override (inline playback; storage answers `Range` requests with 206)

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown `public_id` or `status` is not `ready`

---

#### GET /videos/:publicId/download (SI-03.11)

**Request path parameters:**
- publicId: string, required

**Response 302:**
- Location: presigned `GetObject` URL (videos bucket, `video_key`) on `STORAGE_PUBLIC_ENDPOINT`, TTL 3600 s, with `ResponseContentDisposition: attachment; filename="<ascii-safe original_filename>"; filename*=UTF-8''<encoded original_filename>` (RFC 6266)

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown `public_id` or `status` is not `ready`

---

#### GET /videos/:publicId/thumbnail (SI-03.11)

**Request path parameters:**
- publicId: string, required

**Response 302:**
- Location: presigned `GetObject` URL (thumbnails bucket, `thumbnail_key`) on `STORAGE_PUBLIC_ENDPOINT`, TTL 3600 s

**Error responses:**
- 404 VIDEO_NOT_FOUND: unknown `public_id`, `status` is not `ready`, or `thumbnail_key` is null

#### Validation Rules — Video upload

| Field | Rule | Error message (class-validator) |
|-------|------|---------------------------------|
| filename | `@IsString() @IsNotEmpty() @MaxLength(255)` | filename must be shorter than or equal to 255 characters |
| content_type | `@Matches(/^video\/[a-z0-9.+-]+$/)` | content_type must be a video MIME type |
| size_bytes | `@IsInt() @Min(1) @Max(MAX_VIDEO_SIZE_BYTES)` | size_bytes must not be greater than 10737418240 |
| title | `@IsOptional() @IsString() @Length(1, 100)` | title must be longer than or equal to 1 and shorter than or equal to 100 characters |
| part_numbers | `@IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ArrayUnique() @IsInt({ each: true }) @Min(1, { each: true }) @Max(10000, { each: true })` | part_numbers must contain no more than 100 elements |
| id (path) | `ParseUUIDPipe` | Validation failed (uuid is expected) |

### Authorization Matrix

Owner = the authenticated user whose channel (`channels.user_id = sub`) owns the video (`videos.channel_id`). Another user's video answers `404 VIDEO_NOT_FOUND` — never 403 — so existence is not revealed. Video controllers carry `@SkipThrottle()`: rate limiting stays scoped to the auth endpoints (`phase-02-auth/TD-08`).

| Endpoint | Anonymous | Authenticated | Owner | Notes |
|----------|-----------|---------------|-------|-------|
| POST /channels/me/videos | ✗ (401) | ✓ | n/a | Video is created under the caller's channel |
| GET /channels/me/videos/:id | ✗ (401) | ✗ (404) | ✓ | Any status |
| POST /channels/me/videos/:id/upload-parts | ✗ (401) | ✗ (404) | ✓ | `status = 'draft'` only |
| GET /channels/me/videos/:id/upload-parts | ✗ (401) | ✗ (404) | ✓ | `status = 'draft'` only |
| POST /channels/me/videos/:id/upload-completion | ✗ (401) | ✗ (404) | ✓ | `status ∈ {draft, processing}` |
| GET /videos/:publicId | ✓ | ✓ | ✓ | `@Public()`; `status = 'ready'` only (AMB-2) |
| GET /videos/:publicId/stream | ✓ | ✓ | ✓ | `@Public()`; `status = 'ready'` only |
| GET /videos/:publicId/download | ✓ | ✓ | ✓ | `@Public()`; `status = 'ready'` only |
| GET /videos/:publicId/thumbnail | ✓ | ✓ | ✓ | `@Public()`; `status = 'ready'` only |

Presigned storage URLs are bearer capabilities: each is scoped to one object + one operation and expires in 3600 s (`phase-03-videos/TD-03`, `phase-03-videos/TD-11`).

### Error Catalog

Error response format inherited from phase 02 (`phase-02-auth/TD-07`): `{ statusCode, error, message }` via `DomainExceptionFilter`; validation errors keep `error: "VALIDATION_ERROR"`. New `DomainException` subclasses in `src/videos/videos.exceptions.ts`:

| Code | HTTP | Message | Trigger |
|------|------|---------|---------|
| VIDEO_NOT_FOUND | 404 | Video not found | Owner routes with an unknown `id` or another channel's video; public routes with an unknown/malformed `public_id`, a video whose `status` is not `ready`, or (thumbnail) a null `thumbnail_key` |
| VIDEO_NOT_UPLOADABLE | 409 | Video is not accepting uploads | `upload-parts` (sign/list) when `status != 'draft'`; `upload-completion` when `status ∈ {ready, failed}` |
| INVALID_PART_NUMBER | 400 | Part number exceeds the video part count | `POST .../upload-parts` with any `part_numbers` item > `part_count` |
| UPLOAD_INCOMPLETE | 409 | Upload is incomplete | `POST .../upload-completion` when stored parts do not cover `1..part_count` or their summed size differs from `size_bytes` |

### Events/Messages

#### video-processing / process

**Payload:**

```json
{ "videoId": "uuid" }
```

**Producer:** `VideoProcessingProducer` in `VideosModule` (API), called by `VideosService.completeUpload` right after `CompleteMultipartUpload` and the `status → processing` update (per `phase-03-videos/TD-07`). Job options: `jobId: videoId` (dedup — duplicate `upload-completion` calls are harmless), `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }` (5 s, 10 s) (per `phase-03-videos/TD-06`, `phase-03-videos/TD-01`).
**Consumer:** `VideoProcessingProcessor` (`@Processor('video-processing', { concurrency: 2 })`, extends `WorkerHost`) in the worker-only `VideoProcessingModule`, running in the `video-worker` container via `src/worker.ts` (per `phase-03-videos/TD-08`). The API's `AppModule` never imports the processor.
**Trigger:** `POST /channels/me/videos/:id/upload-completion` succeeded (multipart completed, video in `processing`).
**Processing steps:** load video by `videoId` (missing → log + return; already `ready` → return) → presign an **internal** `GetObject` URL (`phase-03-videos/TD-09`) → `ffprobe` → metadata (no video stream → `UnrecoverableError`) → `ffmpeg -ss <min(1, duration/2)>` single frame → upload `thumbnails/{videoId}/thumbnail.jpg` → persist `duration_seconds`, `metadata`, `thumbnail_key`, `processed_at`, `failure_reason = null`, `status = 'ready'`.
**Failure handling:** `@OnWorkerEvent('failed')` sets `status = 'failed'` and `failure_reason` only when the attempt is final (`job.attemptsMade >= (job.opts.attempts ?? 1)` after the failed attempt is counted, or the error is an `UnrecoverableError`); intermediate failures leave `status = 'processing'` for the retry (per `phase-03-videos/TD-06`).
**Delivery semantics:** at-least-once (BullMQ over Redis with `maxmemory-policy noeviction`); the processor is idempotent (re-running overwrites the same thumbnail key and the same columns) (per `phase-03-videos/TD-01`).

---

## Dependency Map

```
SI-03.1 (root — infra, config)
├── SI-03.2 — depends on SI-03.1 (AWS SDK, minio, storageConfig)
└── SI-03.8 — depends on SI-03.1 (ffmpeg na imagem, bullmq) + SI-03.3 (VideoMetadata)

SI-03.3 (root, independente — entidade + migração)

SI-03.2 + SI-03.3
└── SI-03.4 — VideosService (initiate + owner lookup)
    └── SI-03.5 — endpoints do dono (initiate, owner read)
        └── SI-03.6 — assinar/listar partes
            └── SI-03.7 — conclusão + produtor da fila

SI-03.7 + SI-03.8
└── SI-03.9 — processor + VideoProcessingModule
    └── SI-03.10 — worker.ts + WorkerModule + serviço video-worker
        └── SI-03.11 — rotas públicas + e2e ponta a ponta
            └── SI-03.12 — documentação + openapi.json + verificação manual 1GB
```

Linearized implementation order: SI-03.1 → SI-03.2, SI-03.3 (paralelo) → SI-03.4 → SI-03.5 → SI-03.6 → SI-03.7 → SI-03.8 (pode adiantar logo após SI-03.3) → SI-03.9 → SI-03.10 → SI-03.11 → SI-03.12

---

## Deliverables

- [ ] SI-03.1 — Infra: dependências, Redis, MinIO, FFmpeg e namespaces `storage`/`queue`
- [ ] SI-03.2 — StorageModule: clientes S3 (interno + público), bootstrap de buckets e operações multipart
- [ ] SI-03.3 — Entidade Video e migração CreateVideos
- [ ] SI-03.4 — VideosModule: public_id, pré-cadastro em rascunho e leitura do dono
- [ ] SI-03.5 — Endpoints do dono: iniciar upload e consultar vídeo
- [ ] SI-03.6 — Upload multipart: assinar partes e listar partes enviadas (retomada)
- [ ] SI-03.7 — Conclusão do upload e enfileiramento do processamento
- [ ] SI-03.8 — FfmpegService: extração de metadados (ffprobe) e thumbnail (ffmpeg)
- [ ] SI-03.9 — VideoProcessingProcessor: processamento do job, thumbnail e política de falha
- [ ] SI-03.10 — Runtime do worker: `worker.ts`, `WorkerModule` e serviço `video-worker`
- [ ] SI-03.11 — Entrega pública: detalhes, streaming, download e thumbnail por `public_id`
- [ ] SI-03.12 — Documentação: CLAUDE.md, api.http, openapi.json e verificação manual de 1GB

**Full test suites:**

- [ ] Backend tests pass (`docker compose exec nestjs-api npm test -- --runInBand`)
- [ ] E2E tests pass, with `video-worker` running (`docker compose exec nestjs-api npm run test:e2e`)
- [ ] Type/compilation check passes (`docker compose exec nestjs-api npx tsc --noEmit`)
- [ ] Lint passes (`docker compose exec nestjs-api npm run lint`)
- [ ] Project builds successfully, emitting `dist/main.js` and `dist/worker.js` (`docker compose exec nestjs-api npm run build`)
