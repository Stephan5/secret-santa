output "deploy_role_arn" {
  description = "Set as the repository variable AWS_DEPLOY_ROLE_ARN."
  value       = aws_iam_role.deploy.arn
}

output "boundary_policy_arn" {
  value = aws_iam_policy.boundary.arn
}
