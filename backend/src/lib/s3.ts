
/**
 * backend/src/lib/s3.ts
 *
 * Secure cloud storage layer for Gatekeeper Audio.
 * All stems are encrypted at rest with AES-256 the moment they hit S3.
 * Download links are temporary signed URLs — not permanent, not shareable.
 *
 * Exports (grouped by purpose):
 *
 *  Configuration
 *    isS3Configured()            → guard used by routes before any S3 call
 *    checkS3Health()             → used by /api/health to verify live bucket access
 *
 *  Upload (presigned — client puts directly to S3, no file passes through Next.js)
 *    getUploadPresignedUrl()     → PutObject presigned URL, 15 min, AES-256 enforced
 *    uploadStemToS3()            → server-side upload used by /api/upload/mongo/route.ts
 *
 *  Download (presigned — signed GetObject URL, 10 min expiry)
 *    getDownloadPresignedUrl()   → raw presigned URL string
 *    presignGetStemObject()      → wrapper returning { url, expiresIn } | null,
 *                                  used by /api/download/presign/route.ts
 *
 *  Lambda
 *    invokeSecurityScanLambda()  → called by /api/stems/[stemId]/approve/route.ts
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'

// ---------------------------------------------------------------------------
// Config — pulled safely from environment variables. No hard-coded secrets.
// ---------------------------------------------------------------------------

interface S3Config {
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
}

function getS3Config(): S3Config {
  const region = process.env.AWS_REGION
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY
  const bucketName = process.env.GATEKEEPER_S3_BUCKET

  if (!region || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      'Missing required AWS environment variables: ' +
        'AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, GATEKEEPER_S3_BUCKET',
    )
  }

  return { region, accessKeyId, secretAccessKey, bucketName }
}

// Singleton clients — created once, reused across requests.
let _s3Client: S3Client | null = null
let _lambdaClient: LambdaClient | null = null

function getS3Client(): S3Client {
  if (!_s3Client) {
    const { region, accessKeyId, secretAccessKey } = getS3Config()
    _s3Client = new S3Client({
      region,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return _s3Client
}

function getLambdaClient(): LambdaClient {
  if (!_lambdaClient) {
    const { region, accessKeyId, secretAccessKey } = getS3Config()
    _lambdaClient = new LambdaClient({
      region,
      credentials: { accessKeyId, secretAccessKey },
    })
  }
  return _lambdaClient
}

// ---------------------------------------------------------------------------
// Configuration guards
// ---------------------------------------------------------------------------

/**
 * Returns true only when all four required environment variables are set.
 * Used by routes as a pre-flight check so they return a clean 503 instead
 * of an unhandled exception if AWS isn't configured yet.
 */
export function isS3Configured(): boolean {
  return Boolean(
    process.env.AWS_REGION &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.GATEKEEPER_S3_BUCKET,
  )
}

/**
 * Used by /api/health to verify the app can actually reach the bucket —
 * not just that the env vars are set.
 */
export async function checkS3Health(): Promise<boolean> {
  if (!isS3Configured()) return false
  try {
    const { bucketName } = getS3Config()
    await getS3Client().send(new HeadBucketCommand({ Bucket: bucketName }))
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

/**
 * Generates a PutObject presigned URL so the client can upload a stem
 * directly to S3 without the file passing through the Next.js server.
 *
 * AES-256 SSE is passed as a signed condition, which means S3 will
 * reject any PUT that arrives without the header — the encryption is
 * enforced by the signature, not just requested.
 *
 * Expires in 15 minutes.
 */
export async function getUploadPresignedUrl(
  key: string,
  contentType: string,
): Promise<{ uploadUrl: string; key: string; expiresIn: number }> {
  const { bucketName } = getS3Config()
  const expiresIn = 900 // 15 minutes

  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
    ServerSideEncryption: 'AES256',
  } satisfies PutObjectCommandInput)

  const uploadUrl = await getSignedUrl(getS3Client(), command, { expiresIn })

  return { uploadUrl, key, expiresIn }
}

/**
 * Server-side upload: reads the file buffer and sends it directly from the
 * Next.js server to S3 with AES-256 SSE enforced on the PutObject call.
 * Used by /api/upload/mongo/route.ts (the Mongo/GridFS → S3 migration path).
 */
export async function uploadStemToS3(
  buffer: Buffer,
  key: string,
  contentType: string,
): Promise<{ bucket: string; key: string }> {
  const { bucketName } = getS3Config()

  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: 'AES256', // encrypted the millisecond it hits S3
    }),
  )

  return { bucket: bucketName, key }
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Generates a temporary GetObject presigned URL. Expires strictly in
 * 10 minutes to protect unreleased IP from link sharing.
 *
 * Returns the raw signed URL string — use presignGetStemObject() if you
 * need the { url, expiresIn } shape that the download/presign route expects.
 */
export async function getDownloadPresignedUrl(key: string): Promise<string> {
  const normalizedKey = key.replace(/^gridfs:\/\/ ?/, 'gridfs/')

  const { bucketName } = getS3Config()
  const expiresIn = 600 // 10 minutes — matches the dashboard's "Signed URLs: 10m" pill

  const command = new GetObjectCommand({ Bucket: bucketName, Key: normalizedKey })
  return getSignedUrl(getS3Client(), command, { expiresIn })
}

/**
 * Wrapper used by /api/download/presign/route.ts.
 * Returns { url, expiresIn } when S3 is configured, or null when it isn't
 * — so the route can fall through to its own mock-cloud / error response
 * rather than throwing an unhandled exception.
 */
export async function presignGetStemObject({
  s3Key,
}: {
  s3Key: string
}): Promise<{ url: string; expiresIn: number } | null> {
  if (!isS3Configured()) return null

  const expiresIn = 600
  const url = await getDownloadPresignedUrl(s3Key)

  return { url, expiresIn }
}

// ---------------------------------------------------------------------------
// Lambda — security scan
// ---------------------------------------------------------------------------

export interface ScanResult {
  ok: boolean
  findings: string[]
  scannedAt: string
  stemId?: string | null
}

/**
 * Invokes the security-scan Lambda synchronously (RequestResponse) so the
 * approve route can block on the result before flipping a stem to
 * "encrypted". If the Lambda isn't configured yet, returns a pass-through
 * result with a logged finding — so local dev keeps working without a
 * deployed Lambda.
 */
export async function invokeSecurityScanLambda(payload: {
  stemId: string
  s3Key: string
}): Promise<ScanResult> {
  const lambdaName = process.env.GATEKEEPER_SCAN_LAMBDA_NAME

  if (!lambdaName) {
    return {
      ok: true,
      findings: [
        'Lambda not configured — scan skipped (set GATEKEEPER_SCAN_LAMBDA_NAME to enable)',
      ],
      scannedAt: new Date().toISOString(),
      stemId: payload.stemId,
    }
  }

  const response = await getLambdaClient().send(
    new InvokeCommand({
      FunctionName: lambdaName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    }),
  )

  if (response.FunctionError) {
    throw new Error(`Security scan Lambda errored: ${response.FunctionError}`)
  }

  const raw = response.Payload
    ? Buffer.from(response.Payload).toString('utf-8')
    : '{}'

  const parsed = JSON.parse(raw)

  return {
    ok: Boolean(parsed.ok),
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
    scannedAt: parsed.scannedAt ?? new Date().toISOString(),
    stemId: parsed.stemId ?? payload.stemId,
  }
}
