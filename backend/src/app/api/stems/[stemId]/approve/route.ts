import { StemModel } from '@/models/Stem'
import { connectDB, isMongoConfigured } from '@/lib/mongodb'
import { logAuditEvent } from '@/lib/audit'
import { corsHeaders, jsonResponse } from '@/lib/cors'
//import { notifyOwner } from '@/lib/notifyOwner'

export const runtime = 'nodejs'

// ✅ APPROVE — moves a stem out of review and into the encrypted vault
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
  const { actorId, actorLabel, reviewerName } = body ?? {}

  const stem = await StemModel.findOne({ stemId })
  if (!stem) {
    return jsonResponse({ error: 'Stem not found' }, { status: 404 })
  }
  if (stem.status !== 'awaiting_review') {
    return jsonResponse(
      { error: `Stem is "${stem.status}", not awaiting review — nothing to approve` },
      { status: 409 },
    )
  }

  stem.status = 'encrypted'
  stem.reviewedBy = reviewerName || actorLabel || 'Unknown reviewer'
  stem.reviewedAt = new Date()
  await stem.save()

  await logAuditEvent({
    actorId,
    actorLabel: actorLabel || reviewerName || 'Producer',
    action: 'stem_approved',
    resourceType: 'stem',
    resourceId: stem.stemId,
    detail: { title: stem.title, owner: stem.owner },
  })

 // await notifyOwner({ stem, action: 'stem_approved' })

  return jsonResponse({ ok: true, success: true, stem })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}