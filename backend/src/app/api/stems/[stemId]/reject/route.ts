import { StemModel } from '@/models/Stem'
import { connectDB, isMongoConfigured } from '@/lib/mongodb'
import { logAuditEvent } from '@/lib/audit'
import { corsHeaders, jsonResponse } from '@/lib/cors'
//import { notifyOwner } from '@/lib/notifyOwner'

export const runtime = 'nodejs'

// ❌ REJECT — sends a stem back with a reason, never reaches the vault
export async function POST(
  request: Request,
  { params }: { params: { stemId: string } },
) {
  if (!isMongoConfigured()) {
    return jsonResponse({ error: 'MongoDB is not configured' }, { status: 503 })
  }

  await connectDB()

  const { stemId } = params
  const body = await request.json().catch(() => ({}))
  const { actorId, actorLabel, reviewerName, reason } = body ?? {}

  const stem = await StemModel.findOne({ stemId })
  if (!stem) {
    return jsonResponse({ error: 'Stem not found' }, { status: 404 })
  }
  if (stem.status !== 'awaiting_review') {
    return jsonResponse(
      { error: `Stem is "${stem.status}", not awaiting review — nothing to reject` },
      { status: 409 },
    )
  }

  stem.status = 'rejected'
  stem.reviewedBy = reviewerName || actorLabel || 'Unknown reviewer'
  stem.reviewedAt = new Date()
  stem.rejectionReason = reason || 'No reason provided'
  await stem.save()

  await logAuditEvent({
    actorId,
    actorLabel: actorLabel || reviewerName || 'Producer',
    action: 'stem_rejected',
    resourceType: 'stem',
    resourceId: stem.stemId,
    detail: { title: stem.title, owner: stem.owner, reason: stem.rejectionReason },
  })

  console.log(`[Notification] Stem rejected: ${stem.title}`);

  return jsonResponse({ ok: true, success: true, stem })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}
