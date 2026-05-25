# Gatekeeper Audio — System Architecture

Three layers work together: **Node.js** handles requests and uploads, **MongoDB** stores stems and the audit trail, **Python** transcodes audio and remediates security risks.

| Layer | Responsibility | Primary paths |
|-------|----------------|---------------|
| **React** | Dashboard UI, upload modal, audit display | `src/App.jsx`, `src/App.css`, `src/lib/gatekeeperApi.js` |
| **Node.js** | HTTP API, presigned S3 URLs, Python bridge | `backend/src/app/api/`, `backend/src/lib/` |
| **MongoDB** | Stem metadata + audit trail (who / what / when) | `backend/src/models/Stem.ts`, `AuditEvent.ts` |
| **AWS S3** | Encrypted audio objects (SSE AES-256) | `backend/src/lib/s3.ts` |
| **Python** | Transcode (FFmpeg) + security scan/remediate | `automation/gatekeeper/` |

**Backend API workflows (sequence diagrams, request/response schemas):** [docs/API.md](./docs/API.md)

---

## System map

```mermaid
flowchart TB
  subgraph ui [React Dashboard — port 5173]
    Dash[App.jsx]
    ApiClient[gatekeeperApi.js]
  end

  subgraph node [Node.js API — port 3000]
    Health[/api/health]
    Metrics[/api/metrics]
    Stems[/api/stems]
    Audit[/api/audit]
    UpPre[/api/upload/presign]
    UpDone[/api/upload/complete]
    DlPre[/api/download/presign]
    Scan[/api/automation/scan]
    Pipe[/api/automation/pipeline]
    AutoLib[lib/automation.ts]
  end

  subgraph mongo [MongoDB]
    StemsCol[(stems)]
    AuditCol[(auditevents)]
  end

  subgraph python [Python automation]
    Tasks[gatekeeper.tasks]
    Transcode[transcoder.py]
    Security[security.py]
    Client[client.py]
  end

  subgraph s3 [AWS S3]
    Bucket[(stems/STEM-*/file)]
  end

  Dash --> ApiClient
  ApiClient --> node
  UpPre --> StemsCol
  UpPre --> AuditCol
  UpPre --> Bucket
  UpDone --> StemsCol
  UpDone --> AuditCol
  DlPre --> StemsCol
  DlPre --> AuditCol
  DlPre --> Bucket
  Metrics --> StemsCol
  Metrics --> AuditCol
  Stems --> StemsCol
  Audit --> AuditCol
  Scan --> AutoLib
  Pipe --> AutoLib
  AutoLib --> Tasks
  Tasks --> Transcode
  Tasks --> Security
  Tasks --> Client
  Client --> node
```

---

## Layer 1 — Node.js (requests & file uploads)

**Runtime:** Next.js 15 App Router (`backend/`)

| Concern | Module |
|---------|--------|
| CORS + JSON responses | `src/lib/cors.ts` |
| Env validation | `src/lib/env.ts` |
| S3 presigned URLs | `src/lib/s3.ts` |
| Stem ID + filename sanitization | `src/lib/stemId.ts` |
| Audit writes | `src/lib/audit.ts` |
| Python subprocess | `src/lib/automation.ts` |

### Upload paths

| Path | Flow | Doc |
|------|------|-----|
| **Direct** | Browser → presign → S3 PUT → complete | [Workflow 2](./docs/API.md#workflow-2--direct-stem-upload-browser--s3) |
| **Pipeline** | Browser → multipart → Python → presign → S3 → complete | [Workflow 3](./docs/API.md#workflow-3--python-pipeline-upload-default-in-ui) |

### Access path

Download presign issues a time-limited GET URL and logs the actor to MongoDB. See [Workflow 4](./docs/API.md#workflow-4--download--stem-access).

---

## Layer 2 — MongoDB (stems & audit trail)

**Connection:** `src/lib/mongodb.ts` — uses `MONGODB_URI`.

### Stems collection

| Field | Type | Notes |
|-------|------|-------|
| `stemId` | string | Unique, e.g. `STEM-A1B2C3` |
| `title` | string | Display name |
| `owner` | string | Team / role label |
| `status` | enum | See lifecycle below |
| `s3Key` | string | `stems/{stemId}/{filename}` |
| `contentType` | string | MIME type |
| `sizeBytes` | number? | Set on upload complete |
| `version` | number | Default 1 |
| `createdAt` / `updatedAt` | date | Auto timestamps |

### Audit events collection

| Field | Type | Notes |
|-------|------|-------|
| `actorId` | string? | Client-supplied identifier |
| `actorLabel` | string? | Human-readable actor |
| `action` | string | e.g. `download_presign_issued` |
| `resourceType` | enum | `stem` \| `upload` \| `download` \| `system` |
| `resourceId` | string? | Usually `stemId` |
| `detail` | object | Action-specific metadata |
| `createdAt` | date | Indexed, used for 24h metrics |

### Audit actions (current)

| Action | Trigger |
|--------|---------|
| `upload_presign_issued` | `POST /api/upload/presign` |
| `upload_completed` | `POST /api/upload/complete` |
| `download_presign_issued` | `POST /api/download/presign` |
| `security_scan_completed` | `GET /api/automation/scan` |
| `automation_pipeline_completed` | `POST /api/automation/pipeline` |

### Stem status lifecycle

```
pending_upload  →  encrypted  →  signed_url_active
                      ↑
               awaiting_review (reserved)
```

---

## Layer 3 — Python (transcode & security)

**Package:** `automation/gatekeeper/`

| File | Role |
|------|------|
| `transcoder.py` | FFmpeg → FLAC / WAV / MP3 / AAC; strip metadata |
| `security.py` | Allowlist MIME types, block executables, filename sanitization |
| `client.py` | HTTP client to Node API |
| `tasks.py` | `scan-api`, `pipeline` tasks for Node bridge |
| `cli.py` | Standalone `gatekeeper` CLI |

**Invoked by Node:**

```bash
python -m gatekeeper.tasks scan-api
python -m gatekeeper.tasks pipeline <path> <title> <owner> [format]
```

**Allowlisted outputs:** `audio/flac`, `audio/wav`, `audio/mpeg`, `audio/mp4`

---

## Dashboard → API mapping

| UI section | Data source |
|------------|-------------|
| Security pill (AES-256 · Signed URLs) | Static + health dots from `/api/health` |
| Active Sessions | `/api/metrics` → `activeSessions` |
| Encrypted Stems | `/api/metrics` → `encryptedStems` |
| Pending Reviews | `/api/metrics` → `pendingReviews` |
| Audit Events (24h) | `/api/metrics` → `auditEvents24h` |
| Stem Upload Queue | `/api/stems` |
| Recent Audit Activity | `/api/audit` |
| Upload New Stem | `/api/automation/pipeline` or direct upload |
| Get URL | `/api/download/presign` |

Load sequence: [Workflow 1](./docs/API.md#workflow-1--dashboard-load)

---

## Repository layout

```
AW-APP-Project 2/
├── src/                    # React dashboard
│   ├── App.jsx
│   ├── App.css
│   └── lib/gatekeeperApi.js
├── backend/                # Next.js API
│   └── src/app/api/        # Route handlers
├── automation/             # Python package
│   └── gatekeeper/
├── docs/
│   └── API.md              # Backend workflows & reference
├── ARCHITECTURE.md         # This file
└── README.md               # Quick start
```

---

## Quick start

```bash
# Terminal 1 — Node API
cd backend && cp .env.example .env && npm run dev

# Terminal 2 — React UI
npm run dev

# One-time — Python + ffmpeg
cd automation && pip install -e . && brew install ffmpeg
```

Open http://localhost:5173 (Vite proxies `/api` → `:3000`).

### Required services

| Service | Required for |
|---------|----------------|
| MongoDB | Stems, audit, metrics |
| AWS S3 (or mock cloud) | Real file storage |
| Python + ffmpeg | Pipeline upload & security scan |
