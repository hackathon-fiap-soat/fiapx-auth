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

# New Relic (Etapa 9): GitHub Secrets NEW_RELIC_LICENSE_KEY e NEW_RELIC_ACCOUNT_ID, passados como TF_VAR_* no
# deploy.yml. Vazios = Lambdas sem New Relic (ambiente local).
variable "newrelic_license_key" {
  description = "License key (ingest) do New Relic. Vazio desliga a instrumentação."
  type        = string
  default     = ""
  sensitive   = true
}

variable "newrelic_account_id" {
  description = "Id da conta do New Relic (exigido pela extensão das Lambdas)."
  type        = string
  default     = ""
  sensitive   = true
}
