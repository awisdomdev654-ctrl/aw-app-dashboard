import { GridFSBucket } from 'mongodb'
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
