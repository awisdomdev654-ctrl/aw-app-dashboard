import { StemModel } from '@/models/Stem'
import { connectDB, isMongoConfigured } from '@/lib/mongodb'
import { logAuditEvent } from '@/lib/audit'
import { corsHeaders, jsonResponse } from '@/lib/cors'

export const runtime = 'nodejs'

// ✅ REJECT — marks a stem as rejected and leaves it out of the vault
export async function POST(
  request: Request,
  { params }: { params: Promise<{ stemId: string }> },
) {
  if (!isMongoConfigured()) {
    return jsonResponse({ error: 'MongoDB is not configured' }, { status: 503 })
  }

  await connectDB()

  // Safely await the params promise to conform to Next.js 15 requirements
  const { stemId } = await params
  const body = await request.json().catch(() => ({}))
  const { actorId, actorLabel, reviewerName, feedback } = body ?? {}

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
  if (feedback) {
    stem.feedback = feedback
  }
  await stem.save()

  await logAuditEvent({
    actorId,
    actorLabel: actorLabel || reviewerName || 'Producer',
    action: 'stem_rejected',
    resourceType: 'stem',
    resourceId: stem.stemId,
    detail: { title: stem.title, owner: stem.owner, feedback },
  })

  return jsonResponse({ ok: true, success: true, stem })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}