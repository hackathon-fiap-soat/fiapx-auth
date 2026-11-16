# fiapx-auth

Autenticação do FIAP X: cadastro, login, recuperação e troca de senha e o Lambda Authorizer (JWT RS256), com as rotas `/api/auth/*` no API Gateway.

> Parte do **Hackathon FIAP X — Processador de Vídeos** (PÓS TECH SOAT, Fase 5).
> Etapa 3 concluída (código, testes e Terraform); o deploy pelo GitHub Actions entra na Etapa 8. A documentação vem antes do código: a arquitetura, as decisões (ADRs/RFCs) e os
> contratos ficam em [`fiapx-docs`](https://github.com/hackathon-fiap-soat/fiapx-docs).

## Stack

Node.js 24 (CommonJS) · mysql2 · bcryptjs (custo 12) · jsonwebtoken (RS256) · AWS SDK v3 (SSM, Secrets
Manager, SQS) · Jest · ESLint · Terraform (AWS provider 6.x)

## Rotas

Contrato completo em [`fiapx-docs/api/openapi.yaml`](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/api/openapi.yaml).

| Rota | Lambda | Resposta |
|---|---|---|
| `POST /api/auth/register` | `register` | `201 {id, name, email}`; `422` com erros por campo; `422` genérico para e-mail repetido |
| `POST /api/auth/login` | `login` | `200 {access_token, token_type, expires_in}`; `401` genérico |
| `POST /api/auth/password/forgot` | `password` | sempre `202` (no máximo 1 e-mail a cada 2 min por usuário) |
| `POST /api/auth/password/reset/verify` | `password` | `200 {email_masked, expires_at}` ou `422` |
| `POST /api/auth/password/reset` | `password` | `200` com JWT ou `422`; o link vale 30 min e uma única vez |
| `PUT /api/auth/password` (authorizer) | `password` | `204`; `422` se a senha atual estiver errada |
| rotas protegidas | `authorizer` | sem header → `401`; token inválido → `403`; válido → contexto `user_id`, `email`, `name` |

JWT RS256 de 1 hora com `sub`, `email`, `name`, `iss: fiapx-auth`, `aud: fiapx-api`
([ADR-004](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/04-adrs/ADR-004-autenticacao-api-gateway-lambda-authorizer-jwt-rs256.md)).
Recuperação e troca de senha seguem o
[ADR-017](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/04-adrs/ADR-017-recuperacao-e-troca-de-senha.md):
o token do link tem 32 bytes aleatórios, só o hash SHA-256 vai para o banco, e os e-mails saem como
`SendNotification` (`PASSWORD_RESET`, `PASSWORD_CHANGED`) na fila `notification-commands`.

## Estrutura

```text
src/domain/          Email, User, PasswordPolicy, PasswordResetToken, erros (sem dependência externa)
src/application/     casos de uso (use-cases.js), portas (ports.js) e o comando SendNotification
src/infrastructure/  config (env ou SSM), MySQL, bcrypt, JWT, token seguro, UUID v7, SQS, container
src/handlers/        register, login, password (4 rotas) e authorizer, no formato do API Gateway (payload 2.0)
migrations/          users e password_reset_tokens (database fiapx_auth)
scripts/             migrate.js, dev-server.js (imita o API Gateway), build.sh (zip das Lambdas)
tests/               unit/, contract/ (schemas do fiapx-docs) e integration/ (MySQL + LocalStack)
infra/               Terraform: 4 Lambdas, roles com menor privilégio, rotas, authorizer, logs
```

## Como rodar

Pré-requisitos: Node.js 24 (`.nvmrc`), Docker e os repositórios `fiapx-infra` e `fiapx-docs` clonados ao
lado deste.

```bash
# 1. Ambiente local (MySQL + LocalStack + Mailpit)
(cd ../fiapx-infra/local && docker compose up -d --wait)

# 2. Dependências e variáveis
npm ci
cp .env.example .env && set -a && . ./.env && set +a

# 3. Tabelas do fiapx_auth
npm run migrate

# 4. API local em http://localhost:3001, imitando o API Gateway (inclusive o authorizer)
npm run dev
```

Exemplo:

```bash
curl -X POST localhost:3001/api/auth/register -H 'content-type: application/json' \
  -d '{"name":"Maria","email":"maria@example.com","password":"Senha-forte-123!"}'
curl -X POST localhost:3001/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"maria@example.com","password":"Senha-forte-123!"}'
curl localhost:3001/api/auth/_authorize -H "authorization: Bearer <access_token>"   # valida um token
```

O servidor local também expõe `GET /api/auth/_authorize`, que só existe localmente, para outros serviços
validarem um token. O e-mail de redefinição fica na fila `fiapx-local-notification-commands` do LocalStack
até o `fiapx-notification` (Etapa 6) entregá-lo ao Mailpit.

## Como testar

```bash
npm run lint
npm test                    # unitários e de contrato (sem Docker)
npm run test:integration    # integração com o ambiente local de pé
npm run test:coverage       # tudo, com cobertura mínima de 80% (é o que o CI roda)
```

- Os contract tests validam o `SendNotification` contra os schemas de `../fiapx-docs/contracts` (ou
  `CONTRACTS_DIR`) e rodam os vetores do [contrato do JWT](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/contracts/jwt/README.md)
  no verificador do authorizer. O `fiapx-video-api` (Laravel) roda os mesmos vetores, então os dois aceitam
  e recusam exatamente os mesmos tokens.
- A integração usa os mesmos handlers da AWS, com MySQL, SSM, Secrets Manager e SQS do LocalStack.

## Variáveis de ambiente

| Variável | Uso | Padrão |
|---|---|---|
| `FIAPX_ENV` | Prefixo dos parâmetros `/fiapx/<env>/...` | `local` |
| `AWS_ENDPOINT_URL` | Endpoint da AWS (LocalStack no ambiente local) | — |
| `DB_SECRET_ARN` | Segredo do usuário `fiapx_auth` | SSM `db/auth/secret_arn` |
| `DB_HOST`, `DB_PORT` | Sobrescrevem o host e a porta do segredo | — |
| `JWT_PRIVATE_KEY_SECRET_ARN` | Segredo da chave privada (login e password) | SSM `auth/jwt_private_key_secret_arn` |
| `JWT_PUBLIC_KEY` | Chave pública em PEM (authorizer) | SSM `auth/jwt_public_key` |
| `NOTIFICATION_QUEUE_URL` | Fila `notification-commands` | SSM `sqs/notification-commands/url` |
| `WEB_URL` | Base do link de redefinição | SSM `web/url` |
| `PORT` | Porta do `npm run dev` | `3001` |

Na AWS, o Terraform resolve os parâmetros SSM no deploy e passa os valores como variáveis, então as
Lambdas não consultam o SSM em tempo de execução.

## Infraestrutura (`infra/`)

- Quatro Lambdas `nodejs24.x` (arm64) com o mesmo pacote (`npm run build` → `dist/fiapx-auth.zip`). Cada
  uma tem uma role com só o que usa: `register` lê o segredo do banco; `login` lê o do banco e a chave
  privada; `password` lê os dois e publica na fila `notification-commands`; o `authorizer` não lê segredo.
- `register`, `login` e `password` rodam na VPC (acesso ao Aurora). O `authorizer` fica fora dela: valida o
  JWT só com a chave pública, sem cold start de rede.
- Rotas, integrações e authorizer (REQUEST, payload 2.0, respostas simples, cache de 300 s) no HTTP API do
  `fiapx-infra`. O stage e o rate limit por rota ficam no `fiapx-infra`.
- Publica `/fiapx/<env>/auth/authorizer_id`, usado pelas rotas do `fiapx-video-api`.
- Lê do SSM: `vpc/private_subnet_ids`, `vpc/lambda_security_group_id`, `apigw/api_id`, `db/auth/secret_arn`,
  `auth/jwt_private_key_secret_arn`, `auth/jwt_public_key`, `sqs/notification-commands/url` e `/arn`, `web/url`.
- O CI roda `terraform fmt -check` e `validate`. O `plan` e o `apply` entram na Etapa 8, porque dependem da
  infraestrutura da AWS (Etapa 7). O LocalStack Community não emula o API Gateway HTTP API (v2), então a
  validação local das rotas é feita pelo `npm run dev`.

## Links

- Documentação: [`fiapx-docs`](https://github.com/hackathon-fiap-soat/fiapx-docs)
- Todos os repositórios: [hackathon-fiap-soat](https://github.com/hackathon-fiap-soat)

## Contribuição

- A branch `main` é protegida: toda mudança entra por Pull Request (a aprovação é opcional; qualquer integrante, inclusive o autor, pode fazer o merge).
- O `README.md` deve estar sempre atualizado: toda mudança que afete propósito, stack, como rodar/testar,
  variáveis de ambiente ou links atualiza este arquivo no mesmo PR.
- Nunca commitar segredos (`.env`, chaves, tokens). Use `.env.example` com valores fictícios.
- Contexto para o Claude Code: [`CLAUDE.md`](CLAUDE.md) (projeto, regras e o papel deste repositório) e skills em
  [`.claude/skills/`](.claude/skills/) com os procedimentos deste repositório.

## Licença

[MIT](LICENSE)
