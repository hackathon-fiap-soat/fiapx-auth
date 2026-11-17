'use strict';

/**
 * Integração com o ambiente local real (fiapx-infra/local): MySQL 8.0 e LocalStack (SSM, Secrets Manager e
 * SQS). Roda só com INTEGRATION=1 (`npm run test:integration`), com o compose de pé:
 *   cd ../fiapx-infra/local && docker compose up -d --wait
 *
 * Usa as mesmas Lambdas (handlers) e a mesma configuração da AWS, com AWS_ENDPOINT_URL apontando para o
 * LocalStack e os nomes vindos do SSM em /fiapx/local.
 */
const { SQSClient, ReceiveMessageCommand, DeleteMessageCommand, PurgeQueueCommand } = require('@aws-sdk/client-sqs');

const rodar = process.env.INTEGRATION === '1' ? describe : describe.skip;

process.env.FIAPX_ENV = process.env.FIAPX_ENV || 'local';
process.env.AWS_ENDPOINT_URL = process.env.AWS_ENDPOINT_URL || 'http://localhost:4566';
process.env.AWS_REGION = process.env.AWS_REGION || 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID || 'test';
process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY || 'test';

const container = require('../../src/infrastructure/container');
const { migrar } = require('../../src/infrastructure/migrations');
const register = require('../../src/handlers/register').handler;
const login = require('../../src/handlers/login').handler;
const password = require('../../src/handlers/password').handler;
const authorizer = require('../../src/handlers/authorizer').handler;

const json = (r) => (r.body ? JSON.parse(r.body) : undefined);
const evento = (routeKey, body, extra = {}) => ({ version: '2.0', routeKey, headers: {}, body: JSON.stringify(body), ...extra });

rodar('fluxo completo no ambiente local', () => {
  const sqs = new SQSClient({});
  const email = `integracao+${Date.now()}@example.com`;
  const senha = 'Senha-forte-123!';
  let fila;
  let pool;

  async function mensagens() {
    const r = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: fila, MaxNumberOfMessages: 10, WaitTimeSeconds: 2, MessageAttributeNames: ['All'],
    }));
    const lidas = r.Messages || [];
    for (const m of lidas) await sqs.send(new DeleteMessageCommand({ QueueUrl: fila, ReceiptHandle: m.ReceiptHandle }));
    return lidas.map((m) => JSON.parse(m.Body)).filter((m) => m.payload.recipient_email === email);
  }

  beforeAll(async () => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    const cfg = container.getConfig();
    await migrar(await cfg.database(), { log: () => {} });
    fila = await cfg.notificationQueueUrl();
    await sqs.send(new PurgeQueueCommand({ QueueUrl: fila })).catch(() => {});
    const { createPool } = require('../../src/infrastructure/mysql');
    pool = createPool(await cfg.database());
  });

  afterAll(async () => {
    await pool.end();
    await container.reset();
    jest.restoreAllMocks();
  });

  it('cadastro, login e authorizer com a chave do Secrets Manager e do SSM', async () => {
    const r = await register(evento('POST /api/auth/register', { name: 'Integração', email, password: senha }));
    expect(r.statusCode).toBe(201);
    const [linhas] = await pool.query('SELECT password_hash FROM users WHERE email = ?', [email]);
    expect(linhas[0].password_hash).toMatch(/^\$2[aby]\$12\$/);

    const dup = await register(evento('POST /api/auth/register', { name: 'Outro', email, password: senha }));
    expect(dup.statusCode).toBe(422);

    const l = await login(evento('POST /api/auth/login', { email, password: senha }));
    expect(l.statusCode).toBe(200);
    const auth = await authorizer({ headers: { authorization: `Bearer ${json(l).access_token}` } });
    expect(auth).toMatchObject({ isAuthorized: true, context: { email, name: 'Integração' } });
    await expect(authorizer({ headers: { authorization: 'Bearer x.y.z' } })).resolves.toEqual({ isAuthorized: false });
  });

  it('recuperação: PASSWORD_RESET na fila, link usado uma única vez, PASSWORD_CHANGED', async () => {
    const f = await password(evento('POST /api/auth/password/forgot', { email }));
    expect(f.statusCode).toBe(202);
    const [reset] = await mensagens();
    expect(reset).toMatchObject({ type: 'SendNotification', saga_id: null, payload: { template: 'PASSWORD_RESET' } });
    const token = new URL(reset.payload.action_url).searchParams.get('token');

    const [salvo] = (await pool.query('SELECT token_hash FROM password_reset_tokens ORDER BY created_at DESC LIMIT 1'))[0];
    expect(salvo.token_hash).not.toBe(token);

    const v = await password(evento('POST /api/auth/password/reset/verify', { token }));
    expect(v.statusCode).toBe(200);

    const r = await password(evento('POST /api/auth/password/reset', { token, password: 'Nova-senha-456!' }));
    expect(r.statusCode).toBe(200);
    expect(json(r).token_type).toBe('Bearer');
    const novamente = await password(evento('POST /api/auth/password/reset', { token, password: 'Outra-senha-789!' }));
    expect(novamente.statusCode).toBe(422);

    const [changed] = await mensagens();
    expect(changed.payload.template).toBe('PASSWORD_CHANGED');
    expect((await login(evento('POST /api/auth/login', { email, password: 'Nova-senha-456!' }))).statusCode).toBe(200);
    expect((await login(evento('POST /api/auth/login', { email, password: senha }))).statusCode).toBe(401);
  });

  it('troca de senha logado pelo contexto do authorizer', async () => {
    const l = await login(evento('POST /api/auth/login', { email, password: 'Nova-senha-456!' }));
    const auth = await authorizer({ headers: { authorization: `Bearer ${json(l).access_token}` } });
    const r = await password(evento('PUT /api/auth/password',
      { current_password: 'Nova-senha-456!', new_password: 'Terceira-senha-9!' },
      { requestContext: { authorizer: { lambda: auth.context } } }));
    expect(r.statusCode).toBe(204);
    const [changed] = await mensagens();
    expect(changed.payload.template).toBe('PASSWORD_CHANGED');
  });

  it('migrations são idempotentes', async () => {
    const saida = [];
    await migrar(await container.getConfig().database(), { log: (m) => saida.push(m) });
    expect(saida.pop()).toMatch(/^0 migration\(s\) nova\(s\)/);
  });
});
