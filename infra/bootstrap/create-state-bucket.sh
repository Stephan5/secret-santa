#!/usr/bin/env bash
# Makes the S3 bucket Terraform keeps its state in: private, versioned (so a
# bad state can be rolled back) and encrypted. Run once, with your own AWS
# credentials, before anything else (see the README):
#
#   ./create-state-bucket.sh secret-santa-tfstate-<account id>
set -euo pipefail

bucket=${1:?usage: $0 <bucket name>}
region=${AWS_REGION:-eu-west-2}

aws s3api create-bucket --bucket "$bucket" --region "$region" \
    --create-bucket-configuration LocationConstraint="$region"
aws s3api put-public-access-block --bucket "$bucket" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-versioning --bucket "$bucket" --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$bucket" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'

echo "Made s3://$bucket in $region"
