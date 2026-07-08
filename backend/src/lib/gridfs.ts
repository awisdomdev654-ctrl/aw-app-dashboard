import { GridFSBucket, ObjectId } from 'mongodb'
import { connectDB } from './mongodb'

export async function uploadToGridFS(
  buffer: Buffer,
  filename: string,
  metadata: Record<string, unknown> = {},
): Promise<{ fileId: string }> {
  const conn = await connectDB()
  if (!conn) {
    throw new Error('MongoDB is not connected')
  }

  const db = conn.connection.db
  if (!db) {
    throw new Error('MongoDB database unavailable')
  }

  const bucket = new GridFSBucket(db, { bucketName: 'stems' })

  return new Promise((resolve, reject) => {
    const uploadStream = bucket.openUploadStream(filename, { metadata })
    uploadStream.on('error', reject)
    uploadStream.on('finish', () => {
      resolve({ fileId: uploadStream.id.toString() })
    })
    uploadStream.end(buffer)
  })
}

const GRIDFS_KEY_PREFIX = /^gridfs:\/\/ ?/

export function parseGridFSKey(s3Key: string): string | null {
  const match = s3Key.match(GRIDFS_KEY_PREFIX)
  if (!match) return null
  return s3Key.slice(match[0].length)
}

export async function openGridFSDownloadStream(fileId: string): Promise<{
  stream: NodeJS.ReadableStream
  contentType: string
}> {
  const conn = await connectDB()
  if (!conn) {
    throw new Error('MongoDB is not connected')
  }

  const db = conn.connection.db
  if (!db) {
    throw new Error('MongoDB database unavailable')
  }

  const oid = new ObjectId(fileId)
  const file = await db.collection('stems.files').findOne({ _id: oid })
  if (!file) {
    throw new Error('GridFS file not found')
  }

  const bucket = new GridFSBucket(db, { bucketName: 'stems' })
  const metadata = file.metadata as { contentType?: string } | undefined

  return {
    stream: bucket.openDownloadStream(oid),
    contentType: metadata?.contentType ?? 'application/octet-stream',
  }
}
