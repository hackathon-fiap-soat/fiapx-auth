# Quatro Lambdas com o mesmo pacote e handlers diferentes. Cada uma tem a própria role, com só as
# permissões que usa (fiapx-docs/03-arquitetura/seguranca.md).
locals {
  lambdas = {
    register = {
      handler     = "src/handlers/register.handler"
      memory      = 1024 # bcrypt custo 12 em JavaScript: mais memória = mais CPU = login mais rápido
      vpc         = true
      secrets     = ["db"]
      envia_email = false
    }
    login = {
      handler     = "src/handlers/login.handler"
      memory      = 1024
      vpc         = true
      secrets     = ["db", "jwt"]
      envia_email = false
    }
    password = {
      handler     = "src/handlers/password.handler"
      memory      = 1024
      vpc         = true
      secrets     = ["db", "jwt"]
      envia_email = true
    }
    # O authorizer não acessa banco nem segredo: valida o JWT com a chave pública em variável de ambiente.
    # Fica fora da VPC (sem cold start de ENI) e responde em poucos milissegundos.
    authorizer = {
      handler     = "src/handlers/authorizer.handler"
      memory      = 256
      vpc         = false
      secrets     = []
      envia_email = false
    }
  }

  segredos = {
    db  = data.aws_ssm_parameter.db_secret_arn.value
    jwt = data.aws_ssm_parameter.jwt_private_key_secret_arn.value
  }

  env_comum = {
    FIAPX_ENV = var.env
  }
  env_por_lambda = {
    register = { DB_SECRET_ARN = local.segredos.db }
    login    = { DB_SECRET_ARN = local.segredos.db, JWT_PRIVATE_KEY_SECRET_ARN = local.segredos.jwt }
    password = {
      DB_SECRET_ARN              = local.segredos.db
      JWT_PRIVATE_KEY_SECRET_ARN = local.segredos.jwt
      NOTIFICATION_QUEUE_URL     = data.aws_ssm_parameter.notification_queue_url.value
      WEB_URL                    = data.aws_ssm_parameter.web_url.value
    }
    authorizer = { JWT_PUBLIC_KEY = data.aws_ssm_parameter.jwt_public_key.value }
  }
}

data "aws_iam_policy_document" "assume_lambda" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  for_each           = local.lambdas
  name               = "${local.prefix}-${each.key}"
  assume_role_policy = data.aws_iam_policy_document.assume_lambda.json
}

resource "aws_iam_role_policy_attachment" "logs" {
  for_each   = { for k, v in local.lambdas : k => v if !v.vpc }
  role       = aws_iam_role.lambda[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# Inclui as permissões de logs e de criação das interfaces de rede na VPC.
resource "aws_iam_role_policy_attachment" "vpc" {
  for_each   = { for k, v in local.lambdas : k => v if v.vpc }
  role       = aws_iam_role.lambda[each.key].name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

data "aws_iam_policy_document" "acesso" {
  for_each = { for k, v in local.lambdas : k => v if length(v.secrets) > 0 || v.envia_email }

  dynamic "statement" {
    for_each = length(each.value.secrets) > 0 ? [1] : []
    content {
      sid       = "LerSegredos"
      actions   = ["secretsmanager:GetSecretValue"]
      resources = [for s in each.value.secrets : local.segredos[s]]
    }
  }

  dynamic "statement" {
    for_each = each.value.envia_email ? [1] : []
    content {
      sid       = "PublicarSendNotification"
      actions   = ["sqs:SendMessage"]
      resources = [data.aws_ssm_parameter.notification_queue_arn.value]
    }
  }
}

resource "aws_iam_role_policy" "acesso" {
  for_each = toset([for k, v in local.lambdas : k if length(v.secrets) > 0 || v.envia_email])
  name     = "acesso"
  role     = aws_iam_role.lambda[each.key].id
  policy   = data.aws_iam_policy_document.acesso[each.key].json
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambdas
  name              = "/aws/lambda/${local.prefix}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "this" {
  for_each = local.lambdas

  function_name    = "${local.prefix}-${each.key}"
  role             = aws_iam_role.lambda[each.key].arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = each.value.handler
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  memory_size      = each.value.memory
  timeout          = 10

  environment {
    variables = merge(local.env_comum, local.env_por_lambda[each.key])
  }

  dynamic "vpc_config" {
    for_each = each.value.vpc ? [1] : []
    content {
      subnet_ids         = local.subnet_ids
      security_group_ids = [data.aws_ssm_parameter.lambda_security_group_id.value]
    }
  }

  logging_config {
    log_format = "Text" # os handlers já escrevem uma linha JSON por evento
    log_group  = aws_cloudwatch_log_group.lambda[each.key].name
  }

  depends_on = [aws_iam_role_policy_attachment.logs, aws_iam_role_policy_attachment.vpc]
}
