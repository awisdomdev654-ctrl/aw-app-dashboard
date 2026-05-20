# Gatekeeper Python Automation

Automates the **Gatekeeper Audio** API: stem uploads/downloads, **ffmpeg audio transcoding**, and **security scanning with auto-remediation**.

## Prerequisites

- Python 3.11+
- [ffmpeg](https://ffmpeg.org/) on your `PATH` (required for transcoding)
- Gatekeeper backend running (`cd backend && npm run dev`)

## Install

```bash
cd automation
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e .
```

## Environment

| Variable | Default | Purpose |
|----------|---------|---------|
| `GATEKEEPER_BASE_URL` | `http://127.0.0.1:3000` | API base URL |
| `GATEKEEPER_ACTOR_ID` | — | Audit trail actor ID |
| `GATEKEEPER_ACTOR_LABEL` | — | Audit trail label (e.g. `automation-bot`) |

## Commands

### API (existing)

```bash
gatekeeper health
gatekeeper stems
gatekeeper audit --limit 20
gatekeeper upload ./track.wav --title "Demo" --owner "studio-a"
gatekeeper download STEM-ABC123 -o ./out.flac
```

### Audio transcoding

Normalize any supported input to FLAC, WAV, MP3, or AAC. Metadata is stripped by default.

```bash
gatekeeper transcode ./raw-session.wav -o ./safe/stem.flac --format flac
```

### Security scan

Scan a local file and/or the remote API + stem registry:

```bash
gatekeeper scan-security ./incoming/track.ogg
gatekeeper scan-security --api
gatekeeper scan-security ./track.ogg --api
```

Detects: blocked extensions, non-allowlisted types, path traversal in filenames, empty files, missing Mongo/S3, risky stem content types, stale `pending_upload` stems.

### Auto-remediation

Fix local risks (transcode to allowlisted format, strip metadata, sanitize filenames):

```bash
gatekeeper remediate ./incoming/track.ogg --output-dir ./safe
gatekeeper remediate ./incoming/track.ogg --upload --title "Safe stem" --owner "studio-a"
```

### Full pipeline (recommended)

Transcode → remediate → upload in one step:

```bash
gatekeeper pipeline ./incoming/track.ogg \
  --title "Master stem" \
  --owner "studio-a" \
  --format flac \
  --output-dir ./safe
```

## Allowlisted formats

| Format | Extension | Content-Type |
|--------|-----------|--------------|
| FLAC | `.flac` | `audio/flac` |
| WAV | `.wav` | `audio/wav` |
| MP3 | `.mp3` | `audio/mpeg` |
| AAC | `.m4a` | `audio/mp4` |

## Run without install

```bash
cd automation
PYTHONPATH=. python -m gatekeeper health
```
