# Gatekeeper Python automation

Automate the **Gatekeeper Audio API** (`backend/`) from Python: health checks, stem listing, encrypted uploads via presigned S3 URLs, downloads, and audit log inspection.

## Setup

```bash
cd automation
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

Copy `.env.example` values into your shell or export them before running commands.

Start the API and MongoDB first:

```bash
# Terminal 1 — MongoDB (if not already running)
# mongod ...

# Terminal 2 — Gatekeeper API
cd backend
cp .env.example .env   # edit MONGODB_URI, AWS, or GATEKEEPER_MOCK_CLOUD=true
npm run dev
```

## CLI usage

From the `automation/` directory with the venv activated:

```bash
# Health check
python -m gatekeeper health

# List stems
python -m gatekeeper stems

# Upload a file (full flow: presign → S3 PUT → complete)
python -m gatekeeper upload ./my-track.wav --title "Lead vocal" --owner "studio-a"

# Download by stem ID
python -m gatekeeper download <stemId> -o ./downloaded.wav

# Audit trail
python -m gatekeeper audit --limit 20
```

Environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `GATEKEEPER_BASE_URL` | `http://127.0.0.1:3000` | API base URL |
| `GATEKEEPER_ACTOR_ID` | — | Audit `actorId` |
| `GATEKEEPER_ACTOR_LABEL` | — | Audit `actorLabel` |

## Use as a library

```python
from pathlib import Path
from gatekeeper import GatekeeperClient

client = GatekeeperClient(
    base_url="http://127.0.0.1:3000",
    actor_id="batch-job",
    actor_label="Nightly ingest",
)

print(client.health())
result = client.upload_file(
    Path("track.wav"),
    title="Bass stem",
    owner="producer@example.com",
)
print(result["stemId"])

client.download_file(result["stemId"], Path("out/track.wav"))
```

## Mock cloud mode

If `GATEKEEPER_MOCK_CLOUD=true` in `backend/.env`, presign endpoints return no S3 URLs. Uploads still create stem records and audit events, but bytes are not sent to S3. Downloads will fail until real AWS credentials are configured.

## Project layout

```
automation/
  gatekeeper/
    client.py    # GatekeeperClient
    cli.py       # argparse CLI
  requirements.txt
  README.md
```
