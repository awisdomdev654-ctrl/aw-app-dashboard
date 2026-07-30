import { Readable } from 'node:stream'
import { StemModel } from '@/models/Stem'
import { connectDB, isMongoConfigured } from '@/lib/mongodb'
import { openGridFSDownloadStream, parseGridFSKey } from '@/lib/gridfs'
import { corsHeaders, jsonResponse } from '@/lib/cors'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  if (!isMongoConfigured()) {
    return jsonResponse(
      { error: 'MongoDB is not configured (set MONGODB_URI)' },
      { status: 503 },
    )
  }

  const { searchParams } = new URL(request.url)
  const stemId = searchParams.get('stemId')
  const fileId = searchParams.get('fileId')

  if (!stemId || !fileId) {
    return jsonResponse(
      { error: 'stemId and fileId query params are required' },
      { status: 400 },
    )
  }

  await connectDB()

  // Use a type assertion (as any) here to satisfy TypeScript when reading from a .lean() document
  const stem = (await StemModel.findOne({ stemId }).lean()) as any
  if (!stem) {
    return jsonResponse({ error: 'Stem not found' }, { status: 404 })
  }

  const expectedFileId = parseGridFSKey(stem.s3Key)
  if (!expectedFileId || expectedFileId !== fileId) {
    return jsonResponse({ error: 'Invalid GridFS file for stem' }, { status: 403 })
  }

  try {
    const { stream, contentType } = await openGridFSDownloadStream(fileId)

    return new Response(Readable.toWeb(stream as Readable) as ReadableStream, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=600',
        ...corsHeaders(),
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'GridFS download failed'
    return jsonResponse({ error: message }, { status: 404 })
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() })
}