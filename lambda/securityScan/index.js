// lambda/securityScan/index.js
//
// Triggered synchronously by app/api/stems/[stemId]/approve/route.ts the
// moment a producer hits Approve. Does two real checks against the S3
// object (not a mock):
//
//   1. Magic-byte signature check — confirms the file is actually one of
//      the audio formats this vault accepts, catching a renamed/disguised
//      file before it's treated as "Encrypted" and trusted.
//   2. Encryption-at-rest check — confirms S3 actually applied AES-256 (or
//      KMS) server-side encryption, rather than just assuming the pitch
//      deck's claim is true.
//
// Deploy with Terraform: see infra/main.tf.

const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3')

const s3 = new S3Client({})
const BUCKET = process.env.GATEKEEPER_S3_BUCKET

// Minimal magic-byte signatures for the formats the upload form accepts
// (wav, flac, mp3, ogg, m4a/aac). Extend this list as you add formats.
const SIGNATURES = [
  { format: 'wav', bytes: [0x52, 0x49, 0x46, 0x46] }, // "RIFF"
  { format: 'flac', bytes: [0x66, 0x4c, 0x61, 0x43] }, // "fLaC"
  { format: 'ogg', bytes: [0x4f, 0x67, 0x67, 0x53] }, // "OggS"
  { format: 'mp3-id3', bytes: [0x49, 0x44, 0x33] }, // "ID3" tag
  { format: 'mp3-frame', bytes: [0xff, 0xfb] }, // MPEG frame sync
]

function detectSignature(bytes) {
  const match = SIGNATURES.find((sig) => sig.bytes.every((b, i) => bytes[i] === b))
  return match ? match.format : null
}

async function streamToBuffer(stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

exports.handler = async (event) => {
  const { stemId, s3Key } = event || {}
  const findings = []
  let ok = true

  if (!s3Key) {
    return {
      ok: false,
      findings: ['No s3Key provided to scan'],
      scannedAt: new Date().toISOString(),
      stemId: stemId ?? null,
    }
  }

  try {
    // Only read the first 16 bytes — enough for every signature above,
    // and cheap even on large stems.
    const head = await s3.send(
      new GetObjectCommand({ Bucket: BUCKET, Key: s3Key, Range: 'bytes=0-15' }),
    )
    const chunk = await streamToBuffer(head.Body)
    const signature = detectSignature(chunk)

    if (!signature) {
      ok = false
      findings.push(
        'File signature did not match a known audio format — possible spoofed or disguised file',
      )
    }

    const meta = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: s3Key }))

    if (meta.ServerSideEncryption !== 'AES256' && meta.ServerSideEncryption !== 'aws:kms') {
      ok = false
      findings.push('Object is not encrypted at rest with AES-256/KMS')
    }

    if ((meta.ContentLength ?? 0) > 500 * 1024 * 1024) {
      // Informational only — large stems are common (multitrack stems can
      // be huge), so this doesn't block approval, just flags it.
      findings.push('File exceeds 500MB — flagged for manual review (not blocking)')
    }
  } catch (err) {
    ok = false
    findings.push(`Scan failed: ${err.message}`)
  }

  return {
    ok,
    findings,
    scannedAt: new Date().toISOString(),
    stemId,
  }
}