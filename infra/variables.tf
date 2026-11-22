variable "name" {
  description = "What every resource's name starts with. The deploy role (bootstrap/) can only touch resources named this way, so change both together."
  type        = string
  default     = "secret-santa"
}

variable "region" {
  description = "Where the bucket, table and Lambda live."
  type        = string
  default     = "eu-west-2"
}

variable "domain_name" {
  description = "The site's address."
  type        = string
  default     = "santa.blakeslee.uk"
}

variable "hosted_zone_name" {
  description = "The Route 53 hosted zone domain_name is in."
  type        = string
  default     = "blakeslee.uk"
}
