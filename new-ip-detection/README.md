# IP Detection MVP

Visual IP/trademark detection service. Register subjects, upload reference images, scan query images, get back bounding boxes and similarity scores.

## Stack

- **API:** Hono + TypeScript, Kysely query builder, Zod contracts
- **Worker:** Python single-process poll loop, SigLIP2 + Grounding DINO (pluggable embedding model — defaults to a deterministic fake for local dev)
- **Data:** Postgres + pgvector (embeddings), MinIO (object storage)
- **Topology:** Everything runs under one `docker compose up`

## Quick start

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
# in another shell, once the API is up:
bun install
bun run seed
```

Compose runs a one-shot `migrate` service before the API and worker boot, so
the schema is in place by the time anything starts polling. The API is then
available on `http://localhost:8080`. MinIO console at `http://localhost:9001`
(user/pass `minio`/`miniominio`).

If you want to run migrations from the host instead (e.g. against a manually
started Postgres):

```bash
DATABASE_URL=postgres://postgres:postgres@localhost:5432/ipdetection \
  bun run migrate:up
```

## Layout

```
apps/api/             # Hono API
apps/worker/          # Python ML worker
packages/contracts/   # Shared Zod schemas
infra/                # docker-compose.yml + SQL migrations
scripts/              # migrate runner, seed
tests/fixtures/       # Sample images
benchmarks/           # End-to-end benchmark harness
```

## API

Auth: `Authorization: Bearer <token>` per account.

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/v1/auth/dev` | Dev-only — create account, return token |
| `POST` | `/v1/subjects` | Register subject |
| `GET`  | `/v1/subjects` | List subjects |
| `GET`  | `/v1/subjects/:id` | Get subject |
| `DELETE` | `/v1/subjects/:id` | Delete subject |
| `POST` | `/v1/subjects/:id/references` | Upload reference image |
| `POST` | `/v1/scans` | Upload query image |
| `GET`  | `/v1/scans/:id` | Get scan |
| `GET`  | `/v1/scans/:id/detections` | Get detections |
| `GET`  | `/v1/jobs/:id` | Get job status |

Internal (worker only):

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/internal/jobs/lease` | Lease next pending job |
| `POST` | `/internal/jobs/:id/succeed` | Mark job succeeded |
| `POST` | `/internal/jobs/:id/fail` | Mark job failed |
| `GET`  | `/internal/index-jobs/:id/context` | Index job context |
| `GET`  | `/internal/scan-jobs/:id/context` | Scan job context |

## Build order (12 steps)

1. Repo skeleton + Docker Compose
2. SQL migrations + Kysely
3. Storage service + presigned URLs
4. Subject CRUD
5. Reference upload + `index_reference` jobs ← **customer milestone**
6. Job queue with `FOR UPDATE SKIP LOCKED`
7. Worker poll loop with fake embedder
8. Real SigLIP2 embedding model
9. Scan upload + `detect_scan` jobs
10. Detection persistence + result endpoints
11. Benchmark harness
12. Threshold calibration

## Deferred (post-MVP)

WebAuthn, SAM2, LightGlue, OCR, EUIPO ingestion, RunPod handler, OSS benchmark package, billing, multi-tenant admin.
