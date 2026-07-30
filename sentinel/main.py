"""
sentinel/main.py

Gatekeeper Audio — Python Security Sentinel
Runs as a background worker alongside the Next.js backend.
Polls MongoDB directly (no extra API surface to secure) and flags
anomalous patterns by writing audit events through the backend API.

Checks performed on every cycle (default: every 60 seconds):
  1. Stale reviews  — stems stuck in awaiting_review for > 24 hours
  2. Presign flood  — more than 10 signed URL requests for a single stem
                      within the last hour (potential exfiltration attempt)
  3. Scan failures  — stems that were approved but never passed a scan
                      (Lambda was skipped or errored)
  4. Rejected spike — more than 3 rejections from the same owner in 1 hour
                      (possible bad actor probing the review gate)
"""

import os
import time
import logging
from datetime import datetime, timedelta, timezone

import httpx
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MONGODB_URI           = os.getenv("MONGODB_URI", "mongodb://mongo:27017/gatekeeper")
API_URL               = os.getenv("GATEKEEPER_API_URL", "http://backend:3000")
POLL_INTERVAL         = int(os.getenv("SENTINEL_POLL_INTERVAL_SECONDS", "60"))
STALE_REVIEW_HOURS    = int(os.getenv("SENTINEL_STALE_REVIEW_HOURS", "24"))
PRESIGN_FLOOD_LIMIT   = int(os.getenv("SENTINEL_PRESIGN_FLOOD_LIMIT", "10"))
REJECTION_SPIKE_LIMIT = int(os.getenv("SENTINEL_REJECTION_SPIKE_LIMIT", "3"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [SENTINEL] %(levelname)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Audit event writer — posts findings back through the backend API so they
# appear in the dashboard's Recent Audit Activity feed.
# ---------------------------------------------------------------------------

def post_audit_event(action: str, resource_id: str | None, detail: dict):
    try:
        httpx.post(
            f"{API_URL}/api/audit",
            json={
                "actorId":      "sentinel",
                "actorLabel":   "Python Security Sentinel",
                "action":       action,
                "resourceType": "system",
                "resourceId":   resource_id,
                "detail":       detail,
            },
            timeout=5,
        )
    except Exception as exc:
        log.warning("Could not post audit event: %s", exc)


# ---------------------------------------------------------------------------
# Check 1 — stale reviews
# ---------------------------------------------------------------------------

def check_stale_reviews(stems):
    cutoff = datetime.now(timezone.utc) - timedelta(hours=STALE_REVIEW_HOURS)
    stale = stems.find({
        "status":    "awaiting_review",
        "createdAt": {"$lt": cutoff},
    })

    for stem in stale:
        age_hours = (
            datetime.now(timezone.utc) - stem["createdAt"].replace(tzinfo=timezone.utc)
        ).total_seconds() / 3600

        log.warning("Stale review: %s (%s) — %.1fh since upload",
                    stem["stemId"], stem["title"], age_hours)

        post_audit_event(
            action="sentinel_stale_review",
            resource_id=stem["stemId"],
            detail={
                "title":     stem["title"],
                "owner":     stem["owner"],
                "age_hours": round(age_hours, 1),
                "message":   f"Stem has been awaiting review for {age_hours:.1f} hours",
            },
        )


# ---------------------------------------------------------------------------
# Check 2 — presign flood
# ---------------------------------------------------------------------------

def check_presign_flood(audit_events):
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)

    pipeline = [
        {"$match": {
            "action":    "download_presign_issued",
            "createdAt": {"$gte": one_hour_ago},
        }},
        {"$group": {"_id": "$resourceId", "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": PRESIGN_FLOOD_LIMIT}}},
    ]

    for result in audit_events.aggregate(pipeline):
        stem_id = result["_id"]
        count   = result["count"]
        log.warning("Presign flood: %s — %d signed URLs in the last hour", stem_id, count)
        post_audit_event(
            action="sentinel_presign_flood",
            resource_id=stem_id,
            detail={
                "count":   count,
                "window":  "1 hour",
                "message": f"{count} signed URLs issued for this stem in 1 hour — possible exfiltration attempt",
            },
        )


# ---------------------------------------------------------------------------
# Check 3 — approved stems with no scan record
# ---------------------------------------------------------------------------

def check_unscanned_approvals(stems, audit_events):
    encrypted = stems.find({"status": "encrypted"})

    for stem in encrypted:
        stem_id = stem["stemId"]
        scan_exists = audit_events.find_one({
            "action":     "security_scan_completed",
            "resourceId": stem_id,
        })

        if not scan_exists:
            log.warning("Unscanned approval: %s (%s)", stem_id, stem["title"])
            post_audit_event(
                action="sentinel_unscanned_approval",
                resource_id=stem_id,
                detail={
                    "title":   stem["title"],
                    "owner":   stem["owner"],
                    "message": "Stem reached 'encrypted' status with no security scan on record",
                },
            )


# ---------------------------------------------------------------------------
# Check 4 — rejection spike
# ---------------------------------------------------------------------------

def check_rejection_spike(audit_events, stems):
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)

    rejected_ids = [
        e["resourceId"]
        for e in audit_events.find({
            "action":    "stem_rejected",
            "createdAt": {"$gte": one_hour_ago},
        })
        if e.get("resourceId")
    ]

    if not rejected_ids:
        return

    pipeline = [
        {"$match": {"stemId": {"$in": rejected_ids}}},
        {"$group": {"_id": "$owner", "count": {"$sum": 1}}},
        {"$match": {"count": {"$gt": REJECTION_SPIKE_LIMIT}}},
    ]

    for result in stems.aggregate(pipeline):
        owner = result["_id"]
        count = result["count"]
        log.warning("Rejection spike: %s — %d rejections in the last hour", owner, count)
        post_audit_event(
            action="sentinel_rejection_spike",
            resource_id=None,
            detail={
                "owner":   owner,
                "count":   count,
                "window":  "1 hour",
                "message": f"{owner} had {count} stems rejected in 1 hour — possible policy violation",
            },
        )


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def run():
    log.info("Sentinel starting — connecting to MongoDB at %s", MONGODB_URI)

    client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=10_000)
    db     = client.get_default_database()

    stems        = db["stems"]
    audit_events = db["auditevents"]

    # Import server here (not at module level) so a missing server.py
    # surfaces as a clear warning rather than crashing the whole process
    # before logging is even initialised.
    try:
        from server import start_server
        start_server()
        log.info("Sentinel HTTP server started on port %s",
                 os.getenv("SENTINEL_HTTP_PORT", "8080"))
    except ModuleNotFoundError:
        log.warning("server.py not found — HTTP endpoint disabled. "
                    "Polling loop will still run normally.")

    log.info("Connected. Running checks every %ds.", POLL_INTERVAL)
    log.info("Thresholds: stale=%dh | presign_flood=%d/hr | rejection_spike=%d/hr",
             STALE_REVIEW_HOURS, PRESIGN_FLOOD_LIMIT, REJECTION_SPIKE_LIMIT)

    while True:
        try:
            log.info("--- Running security checks ---")
            check_stale_reviews(stems)
            check_presign_flood(audit_events)
            check_unscanned_approvals(stems, audit_events)
            check_rejection_spike(audit_events, stems)
            log.info("--- Checks complete. Sleeping %ds. ---", POLL_INTERVAL)
        except Exception as exc:
            log.error("Sentinel cycle failed: %s", exc, exc_info=True)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    run()