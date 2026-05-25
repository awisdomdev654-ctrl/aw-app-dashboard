import { AuditEventModel } from '@/models/AuditEvent'
import { StemModel } from '@/models/Stem'
import { connectDB, isMongoConfigured } from '@/lib/mongodb'
import { corsHeaders, jsonResponse } from '@/lib/cors'

export const runtime = 'nodejs'

export async function GET() {
  if (!isMongoConfigured()) {
    return jsonResponse(
      {
        activeSessions: 0,
        encryptedStems: 0,
        pendingReviews: 0,
        auditEvents24h: 0,
        highPrioritySessions: 0,
        awaitingProducer: 0,
        suspiciousActivity: false,
        mock: true,
      },
      { status: 200 },
    )
  }

  await connectDB()

  const stems = await StemModel.find().lean()
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000)

  const encryptedStems = stems.filter((s) => s.status === 'encrypted').length
  const awaitingProducer = stems.filter(
    (s) => s.status === 'awaiting_review',
  ).length
  const pendingUpload = stems.filter((s) => s.status === 'pending_upload').length
  const signedActive = stems.filter(
    (s) => s.status === 'signed_url_active',
  ).length

  const activeOwners = new Set(
    stems
      .filter((s) => s.status === 'signed_url_active')
      .map((s) => s.owner),
  )

  const auditEvents24h = await AuditEventModel.countDocuments({
    createdAt: { $gte: since },
  })

  const highPrioritySessions =
    pendingUpload + signedActive + awaitingProducer

  return jsonResponse({
    activeSessions: activeOwners.size || signedActive,
    encryptedStems,
    pendingReviews: awaitingProducer + pendingUpload,
    auditEvents24h,
    highPrioritySessions,
    awaitingProducer,
    suspiciousActivity: false,
    mock: false,
  })
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}
