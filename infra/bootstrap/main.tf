# The deploy role GitHub Actions assumes, and the boundary on what any role
# it makes can do. Applied once, by hand, with your own credentials (see
# the README); CI then applies ../ with the role.
#
# The role can manage only what's named var.name (the site bucket, the
# table, the Lambda and its role and logs, the state), DNS records for
# var.domain_name only, and CloudFront apart from the distributions in
# var.protected_distribution_ids. Any role it creates or changes must carry
# the boundary, which allows no more than the API needs, so it can't make
# itself a way to more.

data "aws_caller_identity" "current" {}

data "aws_iam_openid_connect_provider" "github" {
  # (already in the account, for the website's deploys: an account can only
  # have one per URL)
  url = "https://token.actions.githubusercontent.com"
}

data "aws_route53_zone" "main" {
  name = var.hosted_zone_name
}

locals {
  account_id = data.aws_caller_identity.current.account_id
  subject    = "repo:${var.github_owner}@${var.github_owner_id}/${var.github_repository}@${var.github_repository_id}:ref:refs/heads/${var.deploy_branch}"
  api_roles  = "arn:aws:iam::${local.account_id}:role/${var.name}-api*"
}

# What the API's role can ever do: read and write the table, and log.
data "aws_iam_policy_document" "boundary" {
  statement {
    sid = "Table"
    actions = [
      "dynamodb:ConditionCheckItem",
      "dynamodb:DeleteItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:Query",
      "dynamodb:UpdateItem",
    ]
    resources = ["arn:aws:dynamodb:${var.region}:${local.account_id}:table/${var.name}"]
  }

  statement {
    sid       = "Logs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${var.name}-*:*"]
  }
}

resource "aws_iam_policy" "boundary" {
  name        = "${var.name}-boundary"
  description = "The most any role the ${var.name} deploy role makes can do"
  policy      = data.aws_iam_policy_document.boundary.json
}

data "aws_iam_policy_document" "deploy_trust" {
  statement {
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [local.subject]
    }
  }
}

resource "aws_iam_role" "deploy" {
  name                 = "${var.name}-deploy"
  description          = "Assumed by ${var.github_owner}/${var.github_repository}'s GitHub Actions on ${var.deploy_branch} to apply its Terraform and deploy the site"
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid       = "StateList"
    actions   = ["s3:ListBucket"]
    resources = ["arn:aws:s3:::${var.state_bucket}"]
  }

  statement {
    sid       = "State"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
    resources = ["arn:aws:s3:::${var.state_bucket}/secret-santa.tfstate*"]
  }

  statement {
    sid     = "SiteBucket"
    actions = ["s3:*"]
    resources = [
      "arn:aws:s3:::${var.name}-site-*",
      "arn:aws:s3:::${var.name}-site-*/*",
    ]
  }

  statement {
    sid     = "Table"
    actions = ["dynamodb:*"]
    resources = [
      "arn:aws:dynamodb:${var.region}:${local.account_id}:table/${var.name}",
      "arn:aws:dynamodb:${var.region}:${local.account_id}:table/${var.name}/*",
    ]
  }

  statement {
    sid       = "Function"
    actions   = ["lambda:*"]
    resources = ["arn:aws:lambda:${var.region}:${local.account_id}:function:${var.name}-*"]
  }

  statement {
    sid     = "Logs"
    actions = ["logs:*"]
    resources = [
      "arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${var.name}-*",
      "arn:aws:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${var.name}-*:*",
    ]
  }

  statement {
    sid       = "LogsList"
    actions   = ["logs:DescribeLogGroups"]
    resources = ["*"]
  }

  statement {
    sid = "ApiRole"
    actions = [
      "iam:DeleteRole",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRolePolicies",
      "iam:ListRoleTags",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateAssumeRolePolicy",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
    ]
    resources = [local.api_roles]
  }

  # Making a role, or changing what it may do, only with the boundary on it
  statement {
    sid = "ApiRoleWrite"
    actions = [
      "iam:AttachRolePolicy",
      "iam:CreateRole",
      "iam:DeleteRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PutRolePermissionsBoundary",
      "iam:PutRolePolicy",
    ]
    resources = [local.api_roles]

    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [aws_iam_policy.boundary.arn]
    }
  }

  statement {
    sid       = "ApiRolePass"
    actions   = ["iam:PassRole"]
    resources = [local.api_roles]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  # CloudFront doesn't scope well by name, and a distribution's id isn't
  # known until it exists, so: all of it, but the protected distributions
  # (below)
  statement {
    sid       = "CloudFront"
    actions   = ["cloudfront:*"]
    resources = ["*"]
  }

  # Certificates (CloudFront's are in us-east-1). ACM won't delete one
  # that's in use, so another site's certificate is safe.
  statement {
    sid       = "Certificates"
    actions   = ["acm:*"]
    resources = ["arn:aws:acm:us-east-1:${local.account_id}:certificate/*"]
  }

  statement {
    sid       = "CertificatesRequest"
    actions   = ["acm:RequestCertificate", "acm:ListCertificates"]
    resources = ["*"]
  }

  statement {
    sid       = "DnsRead"
    actions   = ["route53:GetHostedZone", "route53:ListResourceRecordSets", "route53:ListTagsForResource"]
    resources = ["arn:aws:route53:::hostedzone/${data.aws_route53_zone.main.zone_id}"]
  }

  statement {
    sid       = "DnsList"
    actions   = ["route53:ListHostedZones", "route53:ListHostedZonesByName", "route53:GetChange"]
    resources = ["*"]
  }

  # Only the site's own records, and its certificate's validation records
  statement {
    sid       = "DnsWrite"
    actions   = ["route53:ChangeResourceRecordSets"]
    resources = ["arn:aws:route53:::hostedzone/${data.aws_route53_zone.main.zone_id}"]

    condition {
      test     = "ForAllValues:StringLike"
      variable = "route53:ChangeResourceRecordSetsNormalizedRecordNames"
      values   = [lower(var.domain_name), "_*.${lower(var.domain_name)}"]
    }
  }

  statement {
    sid       = "NoRemovingBoundaries"
    effect    = "Deny"
    actions   = ["iam:DeleteRolePermissionsBoundary"]
    resources = ["*"]
  }

  dynamic "statement" {
    for_each = length(var.protected_distribution_ids) > 0 ? [1] : []

    content {
      sid       = "ProtectedDistributions"
      effect    = "Deny"
      actions   = ["cloudfront:*"]
      resources = [for id in var.protected_distribution_ids : "arn:aws:cloudfront::${local.account_id}:distribution/${id}"]
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "deploy"
  role   = aws_iam_role.deploy.id
  policy = data.aws_iam_policy_document.deploy.json
}
