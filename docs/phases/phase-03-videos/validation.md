---
kind: phase
name: phase-03-videos
status: dirty
issue_count: 15
sources_mtime:
  docs/phases/phase-03-videos/context.md: "2026-11-26T03:07:32-03:00"
  docs/decisions/technical-decisions-phase-03-videos.md: "2026-11-26T02:59:04-03:00"
issues:
  - id: AMB-1
    status: open
    summary: "'metadados' extraídos no processamento não especificados além da duração"
  - id: AMB-2
    status: open
    summary: "Acesso a streaming/download de vídeo em rascunho/processando indefinido (fronteira F04)"
  - id: AMB-3
    status: open
    summary: "'sem impacto na performance' e '10GB funcional' sem critério verificável"
  - id: DG-1
    status: open
    summary: "openapi-docs-nestjs (repo-wide) não herdado; novos endpoints sem convenção OpenAPI"
  - id: OQ-1
    status: open
    summary: "TD-01 pending — Message Queue Technology"
  - id: OQ-2
    status: open
    summary: "TD-02 pending — Object Storage SDK and Storage Env Contract"
  - id: OQ-3
    status: open
    summary: "TD-03 pending — 10GB Upload Protocol and Resumability"
  - id: OQ-4
    status: open
    summary: "TD-04 pending — Browser-Facing Storage Endpoint for Presigned URLs"
  - id: OQ-5
    status: open
    summary: "TD-05 pending — Bucket and Object Key Layout"
  - id: OQ-6
    status: open
    summary: "TD-06 pending — Video Status Lifecycle and Failure Policy"
  - id: OQ-7
    status: open
    summary: "TD-07 pending — Processing Trigger After Upload Completion"
  - id: OQ-8
    status: open
    summary: "TD-08 pending — Video Worker Runtime"
  - id: OQ-9
    status: open
    summary: "TD-09 pending — FFmpeg Source Access for Metadata and Thumbnail Extraction"
  - id: OQ-10
    status: open
    summary: "TD-10 pending — Unique Public Video Identifier"
  - id: OQ-11
    status: open
    summary: "TD-11 pending — Streaming and Download Delivery"
advisories: []
---

# phase-03-videos — Validation

## Findings

### Inconsistencies

_None._

### Ambiguities

- **AMB-1** — Capability "Processamento automático do vídeo após upload (extração de duração e metadados)" names only `duração` explicitly; the set of "metadados" to extract and persist (e.g., resolução, codec, bitrate, tamanho, MIME/container) is not listed, so the Video entity columns and the worker's output contract cannot be decomposed into SIs. Explicit choice: enumerate the metadata fields to persist (in project-plan.md or as part of TD-06/TD-09 resolution), or explicitly state "duração only; other metadata out of scope this phase".
- **AMB-2** — Capabilities "Reprodução via streaming" and "Download do vídeo pelo usuário" do not state who may stream/download a video that is still `rascunho` / processing / failed. The project overview says anonymous users watch freely, but publication is Fase 04 ("Gerenciamento de Vídeos e Canal"), so the access rule could plausibly fall on either side of the 03↔04 boundary. Explicit choice: decide whether in Fase 03 (a) streaming/download is restricted to the owner until publication, (b) open to anyone holding the unique URL, or (c) only the owner can stream/download in this phase and public access lands with Fase 04's publish flow. Also clarify whether "pelo usuário" requires authentication for download.
- **AMB-3** — Capability "Upload de vídeos com suporte a arquivos de até 10GB sem impacto na performance" and deliverable "upload de até 10GB funcional" have no verifiable acceptance criterion: "sem impacto na performance" is not quantified (API memory ceiling? no request held open through the API? concurrent requests unaffected?) and it is unspecified how the 10GB limit is proven (real 10GB e2e is impractical in the test suite). Explicit choice: define the measurable criterion (e.g., "API never buffers/proxies file bytes; memory stays flat during upload") and the verification approach (e.g., limit enforced via configured max size + test with a small file under a reduced limit + manual 10GB smoke test).

### Missing Decisions

_None._

### Dependency Gaps

- **DG-1** — Fase 03 introduces new HTTP endpoints (upload initiation/completion, streaming, download, video lookup by unique URL) that Fases 04/05's frontend will consume, and the repo-wide decision `openapi-docs-nestjs` (already delivered; consumed by `next-frontend-openapi-typing` for FE type generation) was **not** inherited into context.md (Assumption 4: correlated with `medium` score, excluded by the headless default). Without it, `/plan-build` will not instruct the new controllers/DTOs to carry the established OpenAPI decorators, leaving the FE codegen pipeline with undocumented endpoints. Explicit choice: rerun `/plan-context phase-03-videos` interactively and include `openapi-docs-nestjs` as a correlated decision, or record an explicit decision that Fase 03 endpoints are exempt from OpenAPI documentation.

### Inherited Constraint Conflicts

_None._

### Unresolved Open Questions

- **OQ-1** — TD-01 pending — Message Queue Technology. Resolution: fill the **Decision:** field of TD-01 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-2** — TD-02 pending — Object Storage SDK and Storage Env Contract. Resolution: fill the **Decision:** field of TD-02 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-3** — TD-03 pending — 10GB Upload Protocol and Resumability. Resolution: fill the **Decision:** field of TD-03 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-4** — TD-04 pending — Browser-Facing Storage Endpoint for Presigned URLs. Resolution: fill the **Decision:** field of TD-04 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-5** — TD-05 pending — Bucket and Object Key Layout. Resolution: fill the **Decision:** field of TD-05 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-6** — TD-06 pending — Video Status Lifecycle and Failure Policy. Resolution: fill the **Decision:** field of TD-06 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-7** — TD-07 pending — Processing Trigger After Upload Completion. Resolution: fill the **Decision:** field of TD-07 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-8** — TD-08 pending — Video Worker Runtime. Resolution: fill the **Decision:** field of TD-08 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-9** — TD-09 pending — FFmpeg Source Access for Metadata and Thumbnail Extraction. Resolution: fill the **Decision:** field of TD-09 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-10** — TD-10 pending — Unique Public Video Identifier. Resolution: fill the **Decision:** field of TD-10 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.
- **OQ-11** — TD-11 pending — Streaming and Download Delivery. Resolution: fill the **Decision:** field of TD-11 in `docs/decisions/technical-decisions-phase-03-videos.md`, then re-run `/plan-validate phase-03-videos`.

### UI Coverage Gaps

_None._ (UI Inventory deferred — check not applicable.)

## Resolved Issues

_No issues resolved yet._
