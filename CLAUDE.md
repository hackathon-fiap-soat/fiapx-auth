# CLAUDE.md — fiapx-auth

Contexto para o Claude Code (e para quem chega agora). Este arquivo é carregado em toda sessão aberta neste
repositório. Ele resume o projeto e aponta para a documentação completa; não a substitui.

## O projeto

**Hackathon FIAP X** (PÓS TECH SOAT, Fase 5): processador de vídeos. O usuário envia vídeos, o sistema extrai
1 frame por segundo e devolve um zip com as imagens. Requisitos do enunciado: processar vários vídeos ao mesmo
tempo, não perder requisições em picos (fila), acesso com usuário e senha, lista de status por usuário e
e-mail em caso de erro. Entregáveis: documentação da arquitetura, script do banco, links dos repositórios e
vídeo de até 10 minutos.

Stack escolhida pelo time: AWS + Terraform, EKS + KEDA, Laravel 13 (PHP 8.4.27), Lambdas Node.js 24, Aurora
MySQL Serverless v2, SQS (Standard, FIFO e DLQ), S3 com POST pré-assinado, SAGA orquestrada com outbox,
DynamoDB, SES (`nao-responda@hackfiapf5.click`), New Relic, React + Vite no CloudFront (`/api/*` na mesma origem).

Repositórios na organização [hackathon-fiap-soat](https://github.com/hackathon-fiap-soat), clonados lado a lado na mesma pasta:

| Repositório | Papel | Stack | Etapa |
|---|---|---|---|
| [`fiapx-docs`](https://github.com/hackathon-fiap-soat/fiapx-docs) | Documentação: arquitetura, ADRs, RFCs, contratos, OpenAPI, diagramas e entrega | Markdown + Mermaid + JSON Schema | Etapa 1 ✅ |
| [`fiapx-infra`](https://github.com/hackathon-fiap-soat/fiapx-infra) | VPC, EKS, Aurora, S3, SQS, SES, ECR, API Gateway, OIDC, SSM, orquestrador de deploy e ambiente local | Terraform + Helm + docker-compose | Etapa 2 ✅ (local), Etapas 7–8 |
| **fiapx-auth** | Lambdas de cadastro, login, senha e authorizer JWT | Node.js 24 + Terraform | Etapa 3 ✅ |
| [`fiapx-video-api`](https://github.com/hackathon-fiap-soat/fiapx-video-api) | API de vídeos, URLs pré-assinadas, orquestrador da SAGA e outbox | PHP 8.4.27 + Laravel 13 no EKS | Etapa 4 ✅ |
| [`fiapx-video-processor`](https://github.com/hackathon-fiap-soat/fiapx-video-processor) | Worker que extrai os frames com ffmpeg e gera o zip | PHP 8.4.27 + Laravel 13 no EKS + KEDA | Etapa 5 |
| [`fiapx-notification`](https://github.com/hackathon-fiap-soat/fiapx-notification) | E-mails pelo SES com histórico e idempotência no DynamoDB | Node.js 24 + Terraform | Etapa 6 |
| [`fiapx-web`](https://github.com/hackathon-fiap-soat/fiapx-web) | Front-end: cadastro, login, senha, upload, status e download | React + Vite + TypeScript + Tailwind | Etapa 6.5 |

## Onde está a verdade

1. **[`fiapx-docs`](https://github.com/hackathon-fiap-soat/fiapx-docs)** (versionado, `../fiapx-docs`): arquitetura C4, Domain
   Storytelling, ADRs, RFCs, contratos das mensagens (`contracts/`), OpenAPI (`api/openapi.yaml`), modelo
   de dados, ambientes, [parâmetros SSM](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/06-deploy/parametros-ssm.md) e
   [fluxo de deploy](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/06-deploy/fluxo-de-deploy.md).
2. **[Especificação](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/00-especificacao/Projeto-hackton.md)** (`fiapx-docs/00-especificacao/Projeto-hackton.md`):
   especificação completa do time (decisões, plano em etapas §12, regras §13). Na pasta de trabalho local,
   `../Projeto-hackton.md` é um link simbólico para ela.
3. **[Painel de progresso](https://claude.ai/artifact/BNesZU4D21nB7cqUoQp2rL)**: tarefas por etapa e status. Atualize ao concluir uma tarefa.

Se o código e a documentação divergirem, ou algo estiver ambíguo, **pergunte ao time** antes de assumir.
Decisão nova ou que contrarie uma existente vira ADR no `fiapx-docs`.

## Andamento (2026-11-16)

Etapas 0 a 4 concluídas (repositórios, documentação, ambiente local, `fiapx-auth` e `fiapx-video-api`).
Próxima: Etapa 5 (`fiapx-video-processor`).
Ordem do plano: 3 auth → 4 video-api → 5 processor → 6 notification → 6.5 web → 7 infra AWS 🛑 → 8 CI/CD →
9 observabilidade → 10 carga e entregáveis 🛑. O estado atualizado está no painel.

## Regras do time

- **Documentação antes do código.** Mudou contrato, rota, fila ou decisão? Atualize o `fiapx-docs` primeiro.
- **`README.md` sempre atualizado**: toda mudança em propósito, stack, como rodar/testar, variáveis ou links
  atualiza o README no mesmo PR.
- **Nunca commitar segredos** (`.env`, chaves JWT, credenciais). Use `.env.example` com valores fictícios.
- **`terraform apply`/`destroy` na AWS só pelo GitHub Actions** (merge na `main`, ou `deploy-all.yml` e
  `destroy-all.yml` no `fiapx-infra`, ADR-016 e ADR-018). Apply local só no LocalStack.
- **Todo merge na `main` faz deploy** do serviço (decisão do time). O ambiente `prod` é destruído fora das
  demonstrações; nesse período o deploy do merge falha ao ler o SSM, e é esperado.
- `main` protegida: só por PR, aprovação opcional, squash merge, histórico linear. Use a skill `fiapx-pr`.
- Conventional Commits; textos, README e mensagens ao usuário em **português do Brasil** com acentuação;
  identificadores de código em inglês.
- DDD + Clean Architecture: domínio sem framework nem SDK da AWS; dependências apontam para dentro.
- Testes com cobertura ≥ 80% e lint antes de cada commit.

## Ambiente local

`../fiapx-infra/local` sobe MySQL 8.0 (`localhost:3306`), LocalStack 4.14.0 (`http://localhost:4566`) e
Mailpit (UI `http://localhost:8025`, SMTP `localhost:1025`):

```bash
cd ../fiapx-infra/local && docker compose up -d --wait && ./scripts/verificar.sh
```

Para um serviço usar o LocalStack: `AWS_ENDPOINT_URL=http://localhost:4566`, `AWS_ACCESS_KEY_ID=test`,
`AWS_SECRET_ACCESS_KEY=test`, `AWS_REGION=us-east-1`. Os nomes dos recursos vêm do SSM em `/fiapx/local/...`
(mesmas chaves de produção, com `<env>` = `local`).

## Este repositório (Etapa 3 ✅)

Lambdas Node.js 24 atrás do API Gateway, com Terraform em `infra/`. Detalhes de rotas, variáveis e
comandos no `README.md`. Estrutura:

```text
src/domain/          User, Email, Password (política de senha)
src/application/     use-cases.js (register, authenticate, authorize, forgot, verify, reset, change) + ports.js
src/infrastructure/  config (env ou SSM), mysql, security (bcrypt, JWT, token, UUID v7), SQS, container
src/handlers/        register.js, login.js, password.js, authorizer.js
migrations/          users, password_reset_tokens (database fiapx_auth); scripts/migrate.js aplica
scripts/             dev-server.js (imita o API Gateway em :3001), build.sh (zip das Lambdas)
tests/               unit/, contract/ (schemas do ../fiapx-docs) e integration/ (INTEGRATION=1, compose de pé)
infra/               Terraform: Lambdas (LabRole, ADR-019), rotas /api/auth/*, authorizer
```

Regras principais (ADR-004, ADR-017, OpenAPI em `fiapx-docs/api/openapi.yaml`):

- Rotas: `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/password/forgot` (sempre 202),
  `POST /api/auth/password/reset/verify`, `POST /api/auth/password/reset` (devolve JWT),
  `PUT /api/auth/password` (com authorizer, 204).
- JWT RS256, 1 h, claims `sub`, `email`, `name`, `iss: fiapx-auth`, `aud: fiapx-api`. Chave privada no
  Secrets Manager (`fiapx/<env>/auth/jwt-private-key`), pública no SSM (`/auth/jwt_public_key`).
- Authorizer REQUEST, payload 2.0, respostas simples, cache 300 s; repassa `x-user-id`, `x-user-email`,
  `x-user-name`. Falta de header → 401; token inválido → 403 (o front trata os dois como sessão expirada).
- Senha: bcrypt custo 12; política de 8 a 72 caracteres com maiúscula, número e símbolo (cadastro,
  redefinição e troca).
- Erros genéricos: cadastro com e-mail repetido → 422 genérico; recuperação nunca revela se o e-mail existe.
- Token de redefinição: 32 bytes aleatórios, só o hash SHA-256 no banco, 30 min, uso único, sempre no corpo.
- Produz `SendNotification` (`PASSWORD_RESET`, `PASSWORD_CHANGED`) na fila `notification-commands`, com
  `saga_id` e `video_id` nulos.

**DoD da Etapa 3:** testes verdes (≥ 80%); login local devolve JWT válido; o authorizer aceita e rejeita
corretamente; a recuperação gera e-mail no Mailpit e o link redefine a senha uma única vez.

Situação: tudo cumprido, exceto a entrega no Mailpit, que depende do `fiapx-notification` (Etapa 6). Até lá,
o `PASSWORD_RESET` fica na fila `notification-commands` e é validado pelo contract test e pela integração.

Comandos: `npm run lint`, `npm test` (sem Docker), `npm run test:coverage` (com o compose; é o que o CI
roda), `npm run dev`, `npm run migrate`, `npm run build`. Decisões de implementação:

- O verificador segue o [contrato do JWT](https://github.com/hackathon-fiap-soat/fiapx-docs/blob/main/contracts/jwt/README.md)
  (só RS256, `iss`, `aud`, `exp`, tolerância de 30 s, claims `sub`/`email`/`name`), testado pelos vetores em
  `tests/contract/jwt.test.js`. Mudou uma regra? Mude o contrato e os vetores no `fiapx-docs` primeiro,
  porque o `fiapx-video-api` valida o mesmo token.
- O authorizer fica fora da VPC e recebe a chave pública por variável de ambiente (o Terraform lê do SSM no
  deploy). Rotacionar a chave exige novo deploy do `fiapx-auth`.
- Login de e-mail inexistente compara a senha com um hash bcrypt fictício, para o tempo de resposta não
  revelar quem tem cadastro.
- O LocalStack Community não emula o HTTP API (v2): as rotas e o authorizer são exercitados localmente pelo
  `scripts/dev-server.js`.
- `deploy.yml`/`destroy.yml` reutilizáveis (ADR-018) com as credenciais da AWS Academy (ADR-019); as migrations
  rodam pela Lambda `migrate` (sem rota), invocada pelo deploy. SonarCloud entra na Etapa 8.

## Skills deste repositório

| Skill | Quando usar |
|---|---|
| `contratos-de-mensagens` | ao produzir ou consumir mensagens SQS |
| `fiapx-pr` | ao abrir e mergear o PR |
