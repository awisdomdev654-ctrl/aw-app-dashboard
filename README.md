# Gatekeeper Audio

Secure stem vault dashboard with a Next.js API, React frontend, and Python automation (transcoding + security remediation).

## Run locally

**Terminal 1 — API**

```bash
cd backend
cp .env.example .env   # set MONGODB_URI, optional AWS
npm install
npm run dev
```

**Terminal 2 — Dashboard**

```bash
npm install
npm run dev
```

Open http://localhost:5173 — Vite proxies `/api` to the backend on port 3000.

**Python automation** (used by upload pipeline + security scan API)

```bash
cd automation
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
brew install ffmpeg   # macOS — required for transcoding
```

Set `GATEKEEPER_PYTHON` in `backend/.env` if `python3` is not on PATH (e.g. `/path/to/automation/.venv/bin/python3`).

## Production env

| Variable | Where | Purpose |
|----------|-------|---------|
| `VITE_GATEKEEPER_API_URL` | frontend | API base URL (e.g. `https://your-api.vercel.app`) |
| `GATEKEEPER_CORS_ORIGIN` | backend | Allow frontend origin |
| `MONGODB_URI` | backend | Stems + audit |
| AWS vars | backend | S3 presigned uploads |
