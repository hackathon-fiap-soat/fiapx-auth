# Tudo o que vem de outros repositórios é lido do SSM (ADR-001, fiapx-docs/06-deploy/parametros-ssm.md).
locals {
  ssm    = "/fiapx/${var.env}"
  prefix = "fiapx-${var.env}-auth"
}

data "aws_caller_identity" "atual" {}

data "aws_ssm_parameter" "private_subnet_ids" {
  name = "${local.ssm}/vpc/private_subnet_ids"
}

data "aws_ssm_parameter" "lambda_security_group_id" {
  name = "${local.ssm}/vpc/lambda_security_group_id"
}

data "aws_ssm_parameter" "api_id" {
  name = "${local.ssm}/apigw/api_id"
}

data "aws_ssm_parameter" "db_secret_arn" {
  name = "${local.ssm}/db/auth/secret_arn"
}

data "aws_ssm_parameter" "jwt_private_key_secret_arn" {
  name = "${local.ssm}/auth/jwt_private_key_secret_arn"
}

data "aws_ssm_parameter" "jwt_public_key" {
  name = "${local.ssm}/auth/jwt_public_key"
}

# Criada pelo fiapx-notification, que sobe antes deste repositório (ADR-017, ordem de deploy).
data "aws_ssm_parameter" "notification_queue_url" {
  name = "${local.ssm}/sqs/notification-commands/url"
}

data "aws_ssm_parameter" "web_url" {
  name = "${local.ssm}/web/url"
}

locals {
  subnet_ids     = split(",", nonsensitive(data.aws_ssm_parameter.private_subnet_ids.value))
  api_id         = nonsensitive(data.aws_ssm_parameter.api_id.value)
  api_source_arn = "arn:aws:execute-api:${var.region}:${data.aws_caller_identity.atual.account_id}:${local.api_id}/*"
}
