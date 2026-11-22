variable "state_bucket" {
  description = "The bucket Terraform's state is in (from create-state-bucket.sh)."
  type        = string
}

variable "protected_distribution_ids" {
  description = "CloudFront distributions the deploy role must never touch (other sites in the account): it can manage CloudFront otherwise, since a distribution's id isn't known until it exists."
  type        = list(string)
  default     = []
}

variable "name" {
  description = "What every resource's name starts with; the deploy role can only touch resources named this way. Must match the main config's."
  type        = string
  default     = "secret-santa"
}

variable "region" {
  type    = string
  default = "eu-west-2"
}

variable "domain_name" {
  description = "The only DNS names the deploy role may change are this one and its certificate validation records."
  type        = string
  default     = "santa.blakeslee.uk"
}

variable "hosted_zone_name" {
  type    = string
  default = "blakeslee.uk"
}

# GitHub's OIDC tokens for repositories created after July 2026 name the
# owner and repository by id as well as name, so a deleted and re-created
# repository of the same name doesn't match.
variable "github_owner" {
  type    = string
  default = "Stephan5"
}

variable "github_owner_id" {
  type    = number
  default = 20775114
}

variable "github_repository" {
  type    = string
  default = "secret-santa"
}

variable "github_repository_id" {
  type    = number
  default = 1467505407
}

variable "deploy_branch" {
  type    = string
  default = "master"
}
