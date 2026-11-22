terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73"
    }
  }

  # The same bucket as the main config, a different key:
  # terraform init -backend-config="bucket=<state bucket>"
  backend "s3" {
    key          = "bootstrap.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      project = var.name
    }
  }
}
