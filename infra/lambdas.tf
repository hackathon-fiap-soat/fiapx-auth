# Cinco Lambdas com o mesmo pacote e handlers diferentes. Na AWS Academy não é possível criar roles, então
# todas usam a LabRole (fiapx-docs ADR-019). As permissões mínimas de cada uma, que uma role própria teria em
# conta própria, estão em fiapx-docs/03-arquitetura/seguranca.md.
locals {
  lambdas = {
    register = {
      handler = "src/handlers/register.handler"
      memory  = 1024 # bcrypt custo 12 em JavaScript: mais memória = mais CPU = login mais rápido
      vpc     = true
    }
    login = {
      handler = "src/handlers/login.handler"
      memory  = 1024
      vpc     = true
    }
    password = {
      handler = "src/handlers/password.handler"
      memory  = 1024
      vpc     = true
    }
    # Sem rota: o deploy.yml a invoca depois do apply para aplicar migrations/ no Aurora (privado).
    migrate = {
      handler = "src/handlers/migrate.handler"
      memory  = 256
      vpc     = true
    }
    # O authorizer não acessa banco nem segredo: valida o JWT com a chave pública em variável de ambiente.
    # Fica fora da VPC (sem cold start de ENI) e responde em poucos milissegundos.
    authorizer = {
      handler = "src/handlers/authorizer.handler"
      memory  = 256
      vpc     = false
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
    migrate  = { DB_SECRET_ARN = local.segredos.db }
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

data "aws_iam_role" "lab" {
  name = "LabRole"
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each          = local.lambdas
  name              = "/aws/lambda/${local.prefix}-${each.key}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "this" {
  for_each = local.lambdas

  function_name    = "${local.prefix}-${each.key}"
  role             = data.aws_iam_role.lab.arn
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  handler          = each.value.handler
  filename         = var.lambda_zip
  source_code_hash = filebase64sha256(var.lambda_zip)
  memory_size      = each.value.memory
  timeout          = each.key == "migrate" ? 60 : 10

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
}
