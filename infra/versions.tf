terraform {
  required_version = ">= 1.11"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.73"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.8"
    }
  }

  # State lives in the bucket bootstrap/create-state-bucket.sh made, passed
  # at init (so its name, which has the account id in it, stays out of the
  # repo): terraform init -backend-config="bucket=<state bucket>"
  backend "s3" {
    key          = "secret-santa.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}
