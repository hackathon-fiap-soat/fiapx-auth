variable "env" {
  description = "Ambiente (prefixo dos recursos e dos parâmetros /fiapx/<env>/...)."
  type        = string
  default     = "prod"
}

variable "region" {
  description = "Região da AWS."
  type        = string
  default     = "us-east-1"
}

variable "lambda_zip" {
  description = "Pacote gerado por `npm run build`."
  type        = string
  default     = "../dist/fiapx-auth.zip"
}

variable "log_retention_days" {
  description = "Retenção dos logs das Lambdas no CloudWatch."
  type        = number
  default     = 14
}

variable "authorizer_cache_ttl" {
  description = "Cache do resultado do authorizer no API Gateway, em segundos."
  type        = number
  default     = 300
}
