variable "aws_region" {
  description = "AWS region for the vault"
  type        = string
  default     = "us-east-2"
}

variable "bucket_name" {
  description = "Prefix for the S3 bucket name. A random suffix is appended automatically in main.tf, since S3 bucket names must be globally unique across every AWS account, not just yours."
  type        = string
  default     = "gatekeeper-stem-vault"
}


