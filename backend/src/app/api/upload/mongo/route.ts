import { z } from 'zod'
import { StemModel } from '@/models/Stem'
import { connectDB, isMongoConfigured } from '@/lib/mongodb'
import { logAuditEvent } from '@/lib/audit'
import { uploadToGridFS } from '@/lib/gridfs'
import { createStemId, sanitizeFilename } from '@/lib/stemId'
import { corsHeaders, jsonResponse } from '@/lib/cors'
import { notifyOwner } from '@/lib/notifyOwner'

export const runtime = 'nodejs'

const metaSchema = z.object({
  title: z.string().min(1),
  owner: z.string().min(1),
  actorId: z.string().optional(),
  actorLabel: z.string().optional(),
})

export async function POST(request: Request) {
  if (!isMongoConfigured()) {
    return jsonResponse(
      { ok: false, error: 'MongoDB is not configured (set MONGODB_URI)' },
      { status: 503 },
    )
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonResponse({ ok: false, error: 'Expected multipart form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return jsonResponse({ ok: false, error: 'file is required' }, { status: 400 })
  }

  const parsed = metaSchema.safeParse({
    title: formData.get('title'),
    owner: formData.get('owner'),
    actorId: formData.get('actorId') ?? undefined,
    actorLabel: formData.get('actorLabel') ?? undefined,
  })

  if (!parsed.success) {
    return jsonResponse({ ok: false, error: parsed.error.flatten() }, { status: 400 })
  }

  const { title, owner, actorId, actorLabel } = parsed.data
  const safeName = sanitizeFilename(file.name)
  const stemId = createStemId()
  const contentType = file.type || 'application/octet-stream'

  try {
    await connectDB()

    const buffer = Buffer.from(await file.arrayBuffer())
    const { fileId } = await uploadToGridFS(buffer, safeName, {
      stemId,
      title,
      owner,
      contentType,
    })

    const s3Key = `gridfs://${fileId}`

    await StemModel.create({
      stemId,
      title,
      owner,
      status: 'awaiting_review',
      s3Key,
      contentType,
      version: 1,
      sizeBytes: file.size,
    })

    await logAuditEvent({
      actorId,
      actorLabel,
      action: 'review_requested',
      resourceType: 'upload',
      resourceId: stemId,
      detail: {
        title,
        owner,
        filename: safeName,
        sizeBytes: file.size,
        storage: 'gridfs',
        gridfsFileId: fileId,
      },
    })

    // 📨 Tell the owner/producer a stem is waiting on their sign-off.
    await notifyOwner({ stem: { stemId, title, owner }, action: 'review_requested' })

    return jsonResponse({
      ok: true,
      stemId,
      status: 'awaiting_review',
      gridfsFileId: fileId,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Upload failed'
    return jsonResponse({ ok: false, error: message }, { status: 500 })
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}