# Gatekeeper Audio

Secure stem vault dashboard with a Next.js API, React frontend, and Python automation (transcoding + security remediation).

**Stack:** Node.js (requests + uploads) · MongoDB (stems + audit trail) · Python (transcode + security remediation).

## Documentation

| Doc | Contents |
|-----|----------|
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System map, layer responsibilities, component paths, data models |
| [docs/API.md](./docs/API.md) | Backend API reference, request/response schemas, workflow sequence diagrams |


DEMO VIDEO HERE! 
https://www.youtube.com/shorts/r8fYyBm92u4


## Production env

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_GATEKEEPER_API_URL` | frontend | API base URL (e.g. `https://your-api.vercel.app`) |
| `GATEKEEPER_CORS_ORIGIN` | backend | Allow frontend origin |
| `MONGODB_URI` | backend | Stems + audit |
| AWS vars | backend | S3 presigned uploads |
