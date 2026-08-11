# Gatekeeper Audio

Secure stem vault dashboard with a Next.js API, React frontend, and Python automation (transcoding + security remediation).

**Live app:** https://aw-app-dashboard.vercel.app

**Demo video:** https://www.youtube.com/shorts/r8fYyBm92u4

## Stack

- **Frontend:** React + Vite (Vercel)
- **Backend:** Next.js API (Railway, Docker)
- **Database:** MongoDB — stems + audit trail
- **Storage:** AWS S3 — encrypted stems, presigned URLs (10 min expiry)
- **Security:** AWS Lambda security scan, Python transcoding/remediation pipeline, AES-256 at rest
- **Auth:** Producer sign-in gate
