# =============================================================================
# infra/main.tf
# Provisions the Gatekeeper Audio S3 stem vault and a least-privilege IAM
# policy the backend uses to read/write it.
#
# Deploy:
#   cd infra
#   terraform init
#   terraform apply
#
# Outputs the bucket name and IAM policy ARN — paste both into backend/.env
# after the first apply.
# =============================================================================

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.4"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

variable "aws_region" {
  description = "AWS region — must match AWS_REGION in backend/.env"
  type        = string
  default     = "us-east-1"  # your confirmed region
}

variable "bucket_name_prefix" {
  description = "Prefix for the S3 bucket. A random suffix is appended to guarantee global uniqueness."
  type        = string
  default     = "gatekeeper-stem-vault"
}

variable "app_iam_user" {
  description = "Name of the IAM user your backend runs as (the one whose access key is in backend/.env). Leave empty to skip attaching the policy automatically."
  type        = string
  default     = ""
}

# ---------------------------------------------------------------------------
# Unique bucket name — S3 names are global across every AWS account
# ---------------------------------------------------------------------------

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

locals {
  bucket_name = "${var.bucket_name_prefix}-${random_id.bucket_suffix.hex}"
}

# ---------------------------------------------------------------------------
# 🪣 The vault
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "stem_vault" {
  bucket = local.bucket_name

  tags = {
    Project     = "GatekeeperAudio"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}

# AES-256 server-side encryption — every object encrypted the moment it lands.
# Matches ServerSideEncryption: "AES256" in backend/src/lib/s3.ts.
resource "aws_s3_bucket_server_side_encryption_configuration" "stem_vault" {
  bucket = aws_s3_bucket.stem_vault.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
    bucket_key_enabled = true
  }
}

# Version every object — lets you recover an overwritten stem without
# touching the audit trail.
resource "aws_s3_bucket_versioning" "stem_vault" {
  bucket = aws_s3_bucket.stem_vault.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Block every possible public access path. Stems are unreleased IP —
# nothing should ever be reachable without a signed URL.
resource "aws_s3_bucket_public_access_block" "stem_vault" {
  bucket = aws_s3_bucket.stem_vault.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# CORS — allows the frontend (localhost:5173 in dev, your prod domain later)
# to PUT via presigned upload URLs and GET presigned download/stream URLs.
# Matches the crossOrigin="anonymous" attribute on the <audio> tag.
resource "aws_s3_bucket_cors_configuration" "stem_vault" {
  bucket = aws_s3_bucket.stem_vault.id

  cors_rule {
    allowed_headers = ["*"]
    allowed_methods = ["GET", "PUT", "HEAD"]
    allowed_origins = [
      "http://localhost:5173",   # Vite dev server
      "http://localhost:3000",   # Next.js local
      "https://harmonica-cable-captivity.ngrok-free.dev",  # ngrok public tunnel
    ]
    expose_headers  = ["ETag"]
    max_age_seconds = 600        # matches the 10-minute signed URL window
  }
}

# ---------------------------------------------------------------------------
# 🔑 Least-privilege IAM policy for the backend
# Only grants the exact S3 actions the app actually calls:
#   PutObject   → uploadStemToS3()
#   GetObject   → presignGetStemObject() / getDownloadPresignedUrl()
#   HeadObject  → checkS3Health() / security scan Lambda
#   ListBucket  → needed by some SDK operations to give clean 404s
# ---------------------------------------------------------------------------

resource "aws_iam_policy" "gatekeeper_s3_access" {
  name        = "GatekeeperAudioS3Access"
  description = "Least-privilege S3 access for the Gatekeeper Audio backend. Scoped strictly to the stem vault bucket."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "StemObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:PutObject",
          "s3:GetObject",
          "s3:HeadObject",
          "s3:DeleteObject",
        ]
        Resource = "${aws_s3_bucket.stem_vault.arn}/*"
      },
      {
        Sid      = "BucketLevelAccess"
        Effect   = "Allow"
        Action   = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = aws_s3_bucket.stem_vault.arn
      },
      {
        Sid      = "LambdaInvoke"
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction"]
        Resource = aws_lambda_function.security_scan.arn
      },
    ]
  })

  tags = {
    Project   = "GatekeeperAudio"
    ManagedBy = "terraform"
  }
}

# Attach the policy to the IAM user if var.app_iam_user is set.
# If you're using an IAM role (e.g. on ECS/EC2), attach the policy to
# the role instead — skip this resource and do it manually.
resource "aws_iam_user_policy_attachment" "gatekeeper_s3_access" {
  count      = var.app_iam_user != "" ? 1 : 0
  user       = var.app_iam_user
  policy_arn = aws_iam_policy.gatekeeper_s3_access.arn
}

# ---------------------------------------------------------------------------
# Outputs — paste these into backend/.env after terraform apply
# ---------------------------------------------------------------------------

output "bucket_name" {
  description = "Paste this as GATEKEEPER_S3_BUCKET in backend/.env"
  value       = aws_s3_bucket.stem_vault.bucket
}

output "bucket_arn" {
  description = "Use this if you need to reference the bucket in other IAM policies"
  value       = aws_s3_bucket.stem_vault.arn
}

output "bucket_region" {
  description = "Paste this as AWS_REGION in backend/.env"
  value       = var.aws_region
}

output "app_iam_policy_arn" {
  description = "Attach this to your IAM user/role if var.app_iam_user was left empty"
  value       = aws_iam_policy.gatekeeper_s3_access.arn
}

# ---------------------------------------------------------------------------
# 🤖 Lambda — security scan, invoked synchronously on stem approval
# Packages lambda/securityScan/ and deploys it. Node 20.x runtime bundles
# the AWS SDK, but the function's own @aws-sdk/client-s3 dep is included
# via npm install inside the source dir (see pre-apply step in README).
# ---------------------------------------------------------------------------

# Zip the Lambda source directory on every apply — Terraform detects source
# changes via output_base64sha256 and redeploys only when files change.
data "archive_file" "security_scan_zip" {
  type        = "zip"
  source_dir  = "${path.module}/../lambda/securityScan"
  output_path = "${path.module}/build/securityScan.zip"
}

resource "aws_iam_role" "scan_lambda_role" {
  name = "gatekeeper-security-scan-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })

  tags = {
    Project   = "GatekeeperAudio"
    ManagedBy = "terraform"
  }
}

resource "aws_iam_role_policy" "scan_lambda_s3" {
  name = "gatekeeper-scan-lambda-s3"
  role = aws_iam_role.scan_lambda_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:HeadObject"]
        Resource = "${aws_s3_bucket.stem_vault.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_lambda_function" "security_scan" {
  function_name    = "gatekeeper-security-scan"
  role             = aws_iam_role.scan_lambda_role.arn
  handler          = "index.handler"
  runtime          = "nodejs20.x"
  filename         = data.archive_file.security_scan_zip.output_path
  source_code_hash = data.archive_file.security_scan_zip.output_base64sha256
  timeout          = 15

  environment {
    variables = {
      GATEKEEPER_S3_BUCKET = aws_s3_bucket.stem_vault.bucket
    }
  }

  tags = {
    Project   = "GatekeeperAudio"
    ManagedBy = "terraform"
  }
}

output "security_scan_lambda_name" {
  description = "Paste this as GATEKEEPER_SCAN_LAMBDA_NAME in backend/.env"
  value       = aws_lambda_function.security_scan.function_name
}

