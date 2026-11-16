'use strict';

const { GetParameterCommand } = require('@aws-sdk/client-ssm');
const { createConfig } = require('../../src/infrastructure/config');
const { bcryptHasher, secureTokenGenerator, uuidV7 } = require('../../src/infrastructure/security');
const { sqsNotificationPublisher } = require('../../src/infrastructure/sqs-notification-publisher');

function clientes({ parametros = {}, segredos = {} } = {}) {
  const chamadas = [];
  return {
    chamadas,
    ssm: {
      send: async (cmd) => {
        chamadas.push(cmd.input.Name);
        if (!(cmd.input.Name in parametros)) throw new Error(`ParameterNotFound ${cmd.input.Name}`);
        return { Parameter: { Value: parametros[cmd.input.Name] } };
      },
    },
    secrets: {
      send: async (cmd) => {
        chamadas.push(cmd.input.SecretId);
        return { SecretString: segredos[cmd.input.SecretId] };
      },
    },
  };
}

describe('config', () => {
  it('lê do SSM pelo prefixo do ambiente e guarda em memória', async () => {
    const c = clientes({ parametros: { '/fiapx/local/web/url': 'http://localhost:5173' } });
    const cfg = createConfig({ FIAPX_ENV: 'local' }, c);
    expect(await cfg.webUrl()).toBe('http://localhost:5173');
    await cfg.webUrl();
    expect(c.chamadas).toEqual(['/fiapx/local/web/url']);
  });

  it('variável de ambiente tem prioridade sobre o SSM', async () => {
    const c = clientes();
    const cfg = createConfig({ NOTIFICATION_QUEUE_URL: 'http://fila', JWT_PUBLIC_KEY: 'PEM' }, c);
    expect(await cfg.notificationQueueUrl()).toBe('http://fila');
    expect(await cfg.jwtPublicKey()).toBe('PEM');
    expect(c.chamadas).toEqual([]);
  });

  it('lê a chave privada e o banco do Secrets Manager, com DB_HOST sobrescrevendo o host', async () => {
    const c = clientes({
      parametros: {
        '/fiapx/prod/auth/jwt_private_key_secret_arn': 'arn:jwt',
        '/fiapx/prod/db/auth/secret_arn': 'arn:db',
      },
      segredos: {
        'arn:jwt': 'PRIVADA',
        'arn:db': JSON.stringify({ host: 'aurora', port: 3306, username: 'fiapx_auth', password: 's', dbname: 'fiapx_auth' }),
      },
    });
    const cfg = createConfig({ FIAPX_ENV: 'prod', DB_HOST: 'mysql' }, c);
    expect(await cfg.jwtPrivateKey()).toBe('PRIVADA');
    expect(await cfg.database()).toEqual({ host: 'mysql', port: 3306, user: 'fiapx_auth', password: 's', database: 'fiapx_auth' });
  });

  it('não guarda falha em cache: tenta de novo na próxima chamada', async () => {
    const c = clientes();
    const cfg = createConfig({ FIAPX_ENV: 'local' }, c);
    await expect(cfg.webUrl()).rejects.toThrow('ParameterNotFound');
    await expect(cfg.webUrl()).rejects.toThrow('ParameterNotFound');
    expect(c.chamadas).toHaveLength(2);
  });

  it('usa local como ambiente padrão', async () => {
    const c = clientes({ parametros: { '/fiapx/local/web/url': 'x' } });
    await expect(createConfig({}, c).webUrl()).resolves.toBe('x');
  });

  it('cria os clientes da AWS quando não recebe nenhum', () => {
    expect(createConfig({})).toHaveProperty('database');
    expect(GetParameterCommand).toBeDefined();
  });
});

describe('security', () => {
  it('bcrypt com custo 12 confere a senha certa e recusa a errada', async () => {
    const h = bcryptHasher();
    const hash = await h.hash('Senha-forte-123!');
    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    await expect(h.verify('Senha-forte-123!', hash)).resolves.toBe(true);
    await expect(h.verify('outra', hash)).resolves.toBe(false);
  });

  it('o hash fictício do login é um bcrypt válido de custo 12', async () => {
    const { HASH_FICTICIO } = require('../../src/application/use-cases');
    expect(HASH_FICTICIO).toMatch(/^\$2[aby]\$12\$.{53}$/);
    await expect(bcryptHasher().verify('qualquer', HASH_FICTICIO)).resolves.toBe(false);
  });

  it('token de redefinição: 32 bytes em base64url e hash SHA-256', () => {
    const g = secureTokenGenerator();
    const { token, hash } = g.generate();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(g.hashOf(token)).toBe(hash);
    expect(g.generate().token).not.toBe(token);
  });

  it('UUID v7 com versão, variante e ordenação no tempo', () => {
    const a = uuidV7(1_700_000_000_000);
    const b = uuidV7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(uuidV7()).not.toBe(uuidV7());
  });
});

describe('sqsNotificationPublisher', () => {
  it('envia o envelope em JSON com atributos de tipo e correlation_id', async () => {
    const enviados = [];
    const pub = sqsNotificationPublisher(async () => 'http://fila', { send: async (cmd) => enviados.push(cmd.input) });
    await pub.publish({ type: 'SendNotification', correlation_id: 'c', payload: {} });
    expect(enviados[0]).toMatchObject({
      QueueUrl: 'http://fila',
      MessageAttributes: { type: { StringValue: 'SendNotification' }, correlation_id: { StringValue: 'c' } },
    });
    expect(JSON.parse(enviados[0].MessageBody).type).toBe('SendNotification');
  });
});
