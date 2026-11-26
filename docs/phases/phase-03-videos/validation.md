---
kind: phase
name: phase-03-videos
status: clean
issue_count: 0
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-26T03:18:16-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-26T03:16:32-03:00"
issues:
  - id: AMB-1
    status: resolved
    resolved_by: clarification
    summary: "'metadados' extraídos no processamento não especificados além da duração"
  - id: AMB-2
    status: resolved
    resolved_by: clarification
    summary: "Acesso a streaming/download de vídeo em rascunho/processando indefinido (fronteira F04)"
  - id: AMB-3
    status: resolved
    resolved_by: clarification
    summary: "'sem impacto na performance' e '10GB funcional' sem critério verificável"
  - id: DG-1
    status: resolved
    resolved_by: clarification
    summary: "openapi-docs-nestjs (repo-wide) não herdado; novos endpoints sem convenção OpenAPI"
  - id: OQ-1
    status: resolved
    resolved_by: phase-03-videos/TD-01
    summary: "TD-01 pending — Message Queue Technology"
  - id: OQ-2
    status: resolved
    resolved_by: phase-03-videos/TD-02
    summary: "TD-02 pending — Object Storage SDK and Storage Env Contract"
  - id: OQ-3
    status: resolved
    resolved_by: phase-03-videos/TD-03
    summary: "TD-03 pending — 10GB Upload Protocol and Resumability"
  - id: OQ-4
    status: resolved
    resolved_by: phase-03-videos/TD-04
    summary: "TD-04 pending — Browser-Facing Storage Endpoint for Presigned URLs"
  - id: OQ-5
    status: resolved
    resolved_by: phase-03-videos/TD-05
    summary: "TD-05 pending — Bucket and Object Key Layout"
  - id: OQ-6
    status: resolved
    resolved_by: phase-03-videos/TD-06
    summary: "TD-06 pending — Video Status Lifecycle and Failure Policy"
  - id: OQ-7
    status: resolved
    resolved_by: phase-03-videos/TD-07
    summary: "TD-07 pending — Processing Trigger After Upload Completion"
  - id: OQ-8
    status: resolved
    resolved_by: phase-03-videos/TD-08
    summary: "TD-08 pending — Video Worker Runtime"
  - id: OQ-9
    status: resolved
    resolved_by: phase-03-videos/TD-09
    summary: "TD-09 pending — FFmpeg Source Access for Metadata and Thumbnail Extraction"
  - id: OQ-10
    status: resolved
    resolved_by: phase-03-videos/TD-10
    summary: "TD-10 pending — Unique Public Video Identifier"
  - id: OQ-11
    status: resolved
    resolved_by: phase-03-videos/TD-11
    summary: "TD-11 pending — Streaming and Download Delivery"
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

_None._

### Missing Decisions

_None._

### Dependency Gaps

_None._

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

_None._

### UI Coverage Gaps

_None._ (UI Inventory deferred — check not applicable.)

## Resolved Issues

- **AMB-1** — 'metadados' extraídos no processamento não especificados além da duração. `resolved_by: clarification` — persist `duration_seconds` (numeric) + `metadata` jsonb (`width`, `height`, `videoCodec`, `audioCodec` nullable, `formatName`, `bitRate`, `frameRate`, `sizeBytes`, from ffprobe). Recorded in context.md `## Scope` → Clarifications.
- **AMB-2** — Acesso a streaming/download de vídeo em rascunho/processando indefinido. `resolved_by: clarification` — public routes keyed by `public_id` (details, stream, download, thumbnail) serve only `status=ready`; otherwise `404 VIDEO_NOT_FOUND`. Owner reads own video in any status via an authenticated owner route; Phase 04 adds visibility. Recorded in context.md Clarifications.
- **AMB-3** — 'sem impacto na performance' e '10GB funcional' sem critério verificável. `resolved_by: clarification` — (a) no API endpoint accepts video bytes; (b) initiation rejects > 10 GiB with 400; (c) manual run uploads ≥1 GB in parts directly to MinIO with the API responsive; (d) e2e exercises a real multipart upload against MinIO with a small generated video. Recorded in context.md Clarifications.
- **DG-1** — openapi-docs-nestjs (repo-wide) não herdado. `resolved_by: clarification` — `openapi-docs-nestjs` TD-01..TD-03 added to context.md `## Inherited Decisions Detail` + OpenAPI convention in `## Inherited Conventions`; new endpoints carry the OpenAPI decorators and `openapi.json` is re-exported.
- **OQ-1** — TD-01 pending — Message Queue Technology. `resolved_by: phase-03-videos/TD-01` (A — BullMQ + Redis).
- **OQ-2** — TD-02 pending — Object Storage SDK and Storage Env Contract. `resolved_by: phase-03-videos/TD-02` (A — AWS SDK v3; revision 2026-11-26: `pgsty/minio` image, API-side bucket bootstrap).
- **OQ-3** — TD-03 pending — 10GB Upload Protocol and Resumability. `resolved_by: phase-03-videos/TD-03` (A — presigned multipart, 64 MiB parts, 10 GiB cap).
- **OQ-4** — TD-04 pending — Browser-Facing Storage Endpoint. `resolved_by: phase-03-videos/TD-04` (A — dual endpoint).
- **OQ-5** — TD-05 pending — Bucket and Object Key Layout. `resolved_by: phase-03-videos/TD-05` (B — `videos` / `thumbnails` buckets).
- **OQ-6** — TD-06 pending — Video Status Lifecycle and Failure Policy. `resolved_by: phase-03-videos/TD-06` (B — single `status` enum `draft → processing → ready | failed`; diverges from Recommendation A).
- **OQ-7** — TD-07 pending — Processing Trigger. `resolved_by: phase-03-videos/TD-07` (A — `complete` endpoint enqueues, `jobId = videoId`).
- **OQ-8** — TD-08 pending — Video Worker Runtime. `resolved_by: phase-03-videos/TD-08` (A — `video-worker` service, `src/worker.ts`).
- **OQ-9** — TD-09 pending — FFmpeg Source Access. `resolved_by: phase-03-videos/TD-09` (A — presigned GET on internal endpoint).
- **OQ-10** — TD-10 pending — Unique Public Video Identifier. `resolved_by: phase-03-videos/TD-10` (B — `public_id`, 11-char base62 via `node:crypto`).
- **OQ-11** — TD-11 pending — Streaming and Download Delivery. `resolved_by: phase-03-videos/TD-11` (A — 302 to presigned GET on public endpoint).
