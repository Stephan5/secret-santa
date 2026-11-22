# One distribution: the site from S3, and /api/* from the Lambda's function
# URL. Both origins are private, reached only through Origin Access Control,
# and the browser sees one origin, so there's no CORS.

locals {
  # (the same headers the local server adds: src/api/local-server.ts)
  security_headers = jsondecode(file("${path.module}/security-headers.json"))
  api_domain       = trimsuffix(trimprefix(aws_lambda_function_url.api.function_url, "https://"), "/")
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "${var.name}-site"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_origin_access_control" "api" {
  name                              = "${var.name}-api"
  origin_access_control_origin_type = "lambda"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_function" "spa_rewrite" {
  name    = "${var.name}-spa-rewrite"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = file("${path.module}/spa-rewrite.js")
}

resource "aws_cloudfront_response_headers_policy" "security" {
  name = "${var.name}-security"

  security_headers_config {
    content_security_policy {
      content_security_policy = local.security_headers.contentSecurityPolicy
      override                = true
    }

    content_type_options {
      override = true
    }

    frame_options {
      frame_option = "DENY"
      override     = true
    }

    referrer_policy {
      referrer_policy = local.security_headers.referrerPolicy
      override        = true
    }

    strict_transport_security {
      access_control_max_age_sec = 63072000
      include_subdomains         = false
      override                   = true
    }
  }

  custom_headers_config {
    items {
      header   = "X-Robots-Tag"
      value    = local.security_headers.robotsTag
      override = true
    }
  }
}

# What the API gets from the browser's request: its body's type, the
# organiser's session, and the viewer's address, for rate limiting. Not
# Host: the function URL needs its own. (Nor x-amz-content-sha256, the
# body's hash: CloudFront takes that itself, for its signature, and won't
# have it in a policy.)
resource "aws_cloudfront_origin_request_policy" "api" {
  name = "${var.name}-api"

  cookies_config {
    cookie_behavior = "none"
  }

  headers_config {
    header_behavior = "whitelist"

    headers {
      items = ["content-type", "x-admin-token", "CloudFront-Viewer-Address"]
    }
  }

  query_strings_config {
    query_string_behavior = "all"
  }
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = var.domain_name
  aliases             = [var.domain_name]
  default_root_object = "index.html"
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  # (everywhere: the family's spread around the world, and the traffic's tiny)
  price_class = "PriceClass_All"

  origin {
    origin_id                = "site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  origin {
    origin_id                = "api"
    domain_name              = local.api_domain
    origin_access_control_id = aws_cloudfront_origin_access_control.api.id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id           = "site"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa_rewrite.arn
    }
  }

  ordered_cache_behavior {
    path_pattern               = "/api/*"
    target_origin_id           = "api"
    viewer_protocol_policy     = "https-only"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = aws_cloudfront_origin_request_policy.api.id
    response_headers_policy_id = aws_cloudfront_response_headers_policy.security.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
