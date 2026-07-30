 /**
 * backend/src/services/s3Service.js
 *
 * S3 integration for Gatekeeper Audio stems storage.
 * Uses AWS SDK v3 (@aws-sdk/client-s3 + @aws-sdk/s3-request-presigner).
 *
 * Install dependencies first:
 *   npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 *
 * Adjust the relative import path in your app to wherever this file
 * actually lives in your repo.
 */

const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
  } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  const crypto = require("crypto");
  
  // ---- Config from environment (fail fast if misconfigured) ----
  const REGION = process.env.AWS_REGION;
  const BUCKET_NAME = process.env.AWS_S3_STEMS_BUCKET;
  const SIGNED_URL_EXPIRY_SECONDS = parseInt(
    process.env.AWS_S3_SIGNED_URL_EXPIRY_SECONDS || "900",
    10
  );
  
  if (!REGION || !BUCKET_NAME) {
    throw new Error(
      "Missing required S3 config: check AWS_REGION and AWS_S3_STEMS_BUCKET in your .env"
    );
  }
  
  // The SDK's default credential provider chain automatically checks, in order:
  // explicit env vars (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) -> shared config
  // file -> ECS/EC2/Lambda IAM role. So in production behind an attached IAM
  // role, you don't need to (and shouldn't) set explicit keys at all.
  const s3Client = new S3Client({ region: REGION });
  
  /**
   * Uploads a stem file securely to the private bucket.
   * Server-side encryption is enforced at the bucket level (AES256), but we
   * also set it explicitly here as defense in depth.
   *
   * @param {Object} params
   * @param {Buffer|Uint8Array|string} params.fileBuffer - File contents
   * @param {string} params.originalFilename - Original filename (for extension)
   * @param {string} [params.keyPrefix] - Optional folder-like prefix, e.g. `${userId}/stems`
   * @param {string} [params.contentType] - MIME type, e.g. "audio/wav"
   * @returns {Promise<{ key: string, bucket: string }>}
   */
  async function uploadStem({
    fileBuffer,
    originalFilename,
    keyPrefix = "stems",
    contentType = "application/octet-stream",
  }) {
    if (!fileBuffer || !originalFilename) {
      throw new Error("uploadStem requires fileBuffer and originalFilename");
    }
  
    const extension = originalFilename.includes(".")
      ? originalFilename.slice(originalFilename.lastIndexOf("."))
      : "";
    const uniqueKey = `${keyPrefix}/${crypto.randomUUID()}${extension}`;
  
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: uniqueKey,
      Body: fileBuffer,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
      // Belt-and-suspenders: bucket already blocks public access at the
      // account level, but we never rely on object ACLs for privacy.
    });
  
    await s3Client.send(command);
  
    return { key: uniqueKey, bucket: BUCKET_NAME };
  }
  
  /**
   * Generates a time-limited signed URL for streaming or downloading a stem.
   * Use this instead of ever exposing the bucket or objects as public.
   *
   * @param {string} key - The S3 object key returned from uploadStem
   * @param {Object} [options]
   * @param {number} [options.expiresIn] - Override default expiry (seconds)
   * @param {boolean} [options.forceDownload] - Set Content-Disposition: attachment
   * @param {string} [options.downloadFilename] - Filename to suggest on download
   * @returns {Promise<string>} Signed URL
   */
  async function getSignedStemUrl(
    key,
    { expiresIn = SIGNED_URL_EXPIRY_SECONDS, forceDownload = false, downloadFilename } = {}
  ) {
    if (!key) {
      throw new Error("getSignedStemUrl requires a key");
    }
  
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      ...(forceDownload && {
        ResponseContentDisposition: `attachment; filename="${downloadFilename || key.split("/").pop()}"`,
      }),
    });
  
    return getSignedUrl(s3Client, command, { expiresIn });
  }
  
  /**
   * Permanently deletes a stem from the bucket.
   * @param {string} key - The S3 object key
   */
  async function deleteStem(key) {
    if (!key) {
      throw new Error("deleteStem requires a key");
    }
  
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });
  
    await s3Client.send(command);
  }
  
  module.exports = {
    s3Client,
    uploadStem,
    getSignedStemUrl,
    deleteStem,
  };