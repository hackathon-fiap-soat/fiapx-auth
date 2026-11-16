output "lambda_names" {
  description = "Nome de cada Lambda."
  value       = { for k, f in aws_lambda_function.this : k => f.function_name }
}

output "authorizer_id" {
  description = "Id do authorizer (também publicado em /fiapx/<env>/auth/authorizer_id)."
  value       = aws_apigatewayv2_authorizer.jwt.id
}

output "routes" {
  description = "Rotas criadas no API Gateway."
  value       = keys(local.rotas)
}
