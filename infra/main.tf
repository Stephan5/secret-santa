provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project = var.name
    }
  }
}

# CloudFront only takes certificates from us-east-1.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      project = var.name
    }
  }
}

data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  # Made by bootstrap/: what the API's role can ever be allowed, whatever
  # its own policy says
  permissions_boundary = "arn:aws:iam::${local.account_id}:policy/${var.name}-boundary"
}
