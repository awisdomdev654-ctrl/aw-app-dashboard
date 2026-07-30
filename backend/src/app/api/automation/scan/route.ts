// app/api/automation/scan/route.ts
//
// Security scan endpoint — reads sentinel findings that have already been
// written to the audit collection by the Python sentinel worker.
//
// Previously this called runAutomationTask('scan-api') which tried to reach
// the sentinel container over HTTP. The sentinel exposes no HTTP ports —
// it's a background worker that writes directly to MongoDB. Calling it over
// HTTP always timed out and hit the 503 catch block.
//
// Fix: query the audit collection for sentinel findings from the last 24h
// and surface them here. The data is already in the database; no HTTP proxy
// to the sentinel is needed.

import { connectDB, isMongoConfigured } from '@/lib/mongodb'
import { logAuditEvent } from '@/lib/audit'
import { corsHeaders, jsonResponse } from '@/lib/cors'
import { AuditEventModel } from '@/models/AuditEvent'

export const runtime = 'nodejs'

// Sentinel writes findings under these action names (see sentinel/main.py)
const SENTINEL_FINDING_ACTIONS = [
  'sentinel_stale_review',
  'sentinel_presign_flood',
  'sentinel_unscanned_approval',
  'sentinel_rejection_spike',
]

export async function GET() {
  if (!isMongoConfigured()) {
    return jsonResponse(
      { ok: false, error: 'MongoDB is not configured', findings: [], findingCount: 0 },
      { status: 503 },
    )
  }

  try {
    await connectDB()

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000) // last 24h

    // Pull every sentinel finding logged in the last 24 hours, newest first
    const rawFindings = await AuditEventModel.find({
      action: { $in: SENTINEL_FINDING_ACTIONS },
      createdAt: { $gte: since },
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean()

    const findings = rawFindings.map((f) => ({
      action:     f.action,
      resourceId: f.resourceId ?? null,
      detail:     f.detail ?? {},
      detectedAt: f.createdAt,
    }))

    const findingCount       = findings.length
    const ok                 = findingCount === 0
    const suspiciousActivity = !ok

    // Log that a scan was requested so it appears in the audit trail
    await logAuditEvent({
      actorLabel:   'Gatekeeper Dashboard',
      action:       'security_scan_completed',
      resourceType: 'system',
      detail: {
        ok,
        findingCount,
        source: 'sentinel-mongodb',
        window: '24h',
      },
    })

    return jsonResponse({
      ok,
      findings,
      findingCount,
      suspiciousActivity,
      scannedAt: new Date().toISOString(),
      source:    'sentinel-mongodb',
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Scan failed'

    return jsonResponse(
      {
        ok:                 false,
        error:              message,
        findings:           [],
        findingCount:       0,
        suspiciousActivity: true,
      },
      { status: 503 },
    )
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}