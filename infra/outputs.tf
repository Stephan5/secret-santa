output "url" {
  value = "https://${var.domain_name}"
}

# (for CI's deploy step: where the site's files go, and what to invalidate)
output "site_bucket" {
  value = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "api_function_name" {
  value = aws_lambda_function.api.function_name
}
