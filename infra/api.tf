# Rotas /api/auth/* no HTTP API criado pelo fiapx-infra (o stage e o rate limit por rota ficam lá).
locals {
  rotas = {
    "POST /api/auth/register"              = { lambda = "register", autenticada = false }
    "POST /api/auth/login"                 = { lambda = "login", autenticada = false }
    "POST /api/auth/password/forgot"       = { lambda = "password", autenticada = false }
    "POST /api/auth/password/reset/verify" = { lambda = "password", autenticada = false }
    "POST /api/auth/password/reset"        = { lambda = "password", autenticada = false }
    "PUT /api/auth/password"               = { lambda = "password", autenticada = true }
  }
  lambdas_http = toset([for r in local.rotas : r.lambda])
}

resource "aws_apigatewayv2_integration" "lambda" {
  for_each               = local.lambdas_http
  api_id                 = local.api_id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.this[each.key].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 10000
}

# REQUEST, payload 2.0, respostas simples. Sem o header Authorization, o API Gateway responde 401 sem
# chamar a Lambda; com isAuthorized=false, responde 403.
resource "aws_apigatewayv2_authorizer" "jwt" {
  api_id                            = local.api_id
  name                              = "${local.prefix}-jwt"
  authorizer_type                   = "REQUEST"
  authorizer_uri                    = aws_lambda_function.this["authorizer"].invoke_arn
  authorizer_payload_format_version = "2.0"
  enable_simple_responses           = true
  identity_sources                  = ["$request.header.Authorization"]
  authorizer_result_ttl_in_seconds  = var.authorizer_cache_ttl
}

resource "aws_apigatewayv2_route" "auth" {
  for_each           = local.rotas
  api_id             = local.api_id
  route_key          = each.key
  target             = "integrations/${aws_apigatewayv2_integration.lambda[each.value.lambda].id}"
  authorization_type = each.value.autenticada ? "CUSTOM" : "NONE"
  authorizer_id      = each.value.autenticada ? aws_apigatewayv2_authorizer.jwt.id : null
}

resource "aws_lambda_permission" "api" {
  for_each      = local.lambdas_http
  statement_id  = "PermitirApiGateway"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = local.api_source_arn
}

resource "aws_lambda_permission" "authorizer" {
  statement_id  = "PermitirAuthorizer"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.this["authorizer"].function_name
  principal     = "apigateway.amazonaws.com"
  # Num HTTP API, a chamada do authorizer vem de <execution_arn>/authorizers/<id>, sem o segmento do stage.
  source_arn = "${local.api_execution_arn}/authorizers/${aws_apigatewayv2_authorizer.jwt.id}"
}

# O fiapx-video-api usa o mesmo authorizer nas rotas /api/videos* (ADR-010).
resource "aws_ssm_parameter" "authorizer_id" {
  name  = "${local.ssm}/auth/authorizer_id"
  type  = "String"
  value = aws_apigatewayv2_authorizer.jwt.id
}
