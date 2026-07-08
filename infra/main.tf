resource "random_id" "bucket_suffix" {
  byte_length = 4
}

locals {
  bucket_name = "${var.bucket_name}-${random_id.bucket_suffix.hex}"
}

# ---------------------------------------------------------------------------
# 🪣 The vault — encrypted, versioned, fully private
# ---------------------------------------------------------------------------

resource "aws_s3_bucket" "stem_vault" {
  bucket = local.bucket_name
}

resource "aws_s3_bucket_versioning" "stem_vault" {
  bucket = aws_s3_bucket.stem_vault.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "stem_vault" {
  bucket = aws_s3_bucket.stem_vault.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "stem_vault" {
  bucket                  = aws_s3_bucket.stem_vault.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ---------------------------------------------------------------------------
# 🤖 Lambda — auto security scan, invoked synchronously on stem approval
# ---------------------------------------------------------------------------

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
}

resource "aws_iam_role_policy" "scan_lambda_policy" {
  name = "gatekeeper-security-scan-policy"
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
}

# ---------------------------------------------------------------------------
# 🔑 Permissions the Next.js app needs — attach this policy's ARN to
# whatever IAM user or role your app runs as (see outputs.tf).
# ---------------------------------------------------------------------------

resource "aws_iam_policy" "app_access" {
  name = "gatekeeper-app-access"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject", "s3:HeadObject"]
        Resource = "${aws_s3_bucket.stem_vault.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = "s3:ListBucket"
        Resource = aws_s3_bucket.stem_vault.arn
      },
      {
        Effect   = "Allow"
        Action   = "lambda:InvokeFunction"
        Resource = aws_lambda_function.security_scan.arn
      }
    ]
  })
}
