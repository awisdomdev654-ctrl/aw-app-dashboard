output "bucket_name" {
  value = aws_s3_bucket.stem_vault.bucket
}

output "security_scan_lambda_name" {
  value = aws_lambda_function.security_scan.function_name
}

output "app_access_policy_arn" {
  description = "Attach this to your app's IAM user/role: aws iam attach-user-policy --user-name <you> --policy-arn <this>"
  value       = aws_iam_policy.app_access.arn
}
