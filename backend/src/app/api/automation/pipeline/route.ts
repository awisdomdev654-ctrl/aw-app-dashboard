import { mkdtemp, rm, writeFile } from 'fs/promises'
import os from 'os'
import path from 'path'
import { z } from 'zod'
import { logAuditEvent } from '@/lib/audit'
import { AutomationError, runAutomationTask } from '@/lib/automation'
import { corsHeaders, jsonResponse } from '@/lib/cors'

export const runtime = 'nodejs'

const metaSchema = z.object({
  title: z.string().min(1),
  owner: z.string().min(1),
  format: z.enum(['flac', 'wav', 'mp3', 'aac']).optional(),
})

export async function POST(request: Request) {
  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return jsonResponse({ error: 'Expected multipart form data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return jsonResponse({ error: 'file is required' }, { status: 400 })
  }

  const parsed = metaSchema.safeParse({
    title: formData.get('title'),
    owner: formData.get('owner'),
    format: formData.get('format') ?? 'flac',
  })

  if (!parsed.success) {
    return jsonResponse({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { title, owner, format = 'flac' } = parsed.data
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'gatekeeper-upload-'))
  const safeName = path.basename(file.name).replace(/[/\\]/g, '_') || 'upload.bin'
  const tmpPath = path.join(tmpDir, safeName)

  try {
    await writeFile(tmpPath, Buffer.from(await file.arrayBuffer()))

    const result = await runAutomationTask('pipeline', [
      tmpPath,
      title,
      owner,
      format,
    ])

    await logAuditEvent({
      actorLabel: 'Gatekeeper Dashboard',
      action: 'automation_pipeline_completed',
      resourceType: 'upload',
      resourceId:
        typeof result.upload === 'object' &&
        result.upload !== null &&
        'stemId' in (result.upload as object)
          ? String((result.upload as { stemId: string }).stemId)
          : undefined,
      detail: { title, owner, format, ok: result.ok },
    })

    return jsonResponse(result)
  } catch (err) {
    const message =
      err instanceof AutomationError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Pipeline failed'

    return jsonResponse({ ok: false, error: message }, { status: 503 })
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}
