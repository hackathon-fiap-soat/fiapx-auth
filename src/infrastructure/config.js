'use strict';

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

/**
 * Configuração resolvida sob demanda e guardada em memória enquanto a Lambda estiver quente.
 *
 * Cada valor vem de uma variável de ambiente (o Terraform as preenche na AWS) ou, se ela não existir, do
 * SSM em /fiapx/<FIAPX_ENV>/... (ambiente local). Segredos vêm do Secrets Manager. Os SDKs da AWS
 * respeitam AWS_ENDPOINT_URL, o que aponta tudo para o LocalStack no ambiente local.
 *
 * Cada Lambda só lê o que usa: o authorizer, por exemplo, nunca toca no Secrets Manager.
 */
function createConfig(env = process.env, clients = {}) {
  const ssm = clients.ssm || new SSMClient({});
  const secrets = clients.secrets || new SecretsManagerClient({});
  const prefixo = `/fiapx/${env.FIAPX_ENV || 'local'}`;
  const cache = new Map();

  function memo(chave, fn) {
    if (!cache.has(chave)) {
      cache.set(chave, fn().catch((e) => {
        cache.delete(chave);
        throw e;
      }));
    }
    return cache.get(chave);
  }

  async function parametro(nome) {
    const r = await ssm.send(new GetParameterCommand({ Name: `${prefixo}/${nome}` }));
    return r.Parameter.Value;
  }

  async function segredo(arn) {
    const r = await secrets.send(new GetSecretValueCommand({ SecretId: arn }));
    return r.SecretString;
  }

  const deEnvOuSsm = (variavel, nome) => memo(variavel, async () => env[variavel] || parametro(nome));

  return {
    webUrl: () => deEnvOuSsm('WEB_URL', 'web/url'),
    notificationQueueUrl: () => deEnvOuSsm('NOTIFICATION_QUEUE_URL', 'sqs/notification-commands/url'),
    jwtPublicKey: () => deEnvOuSsm('JWT_PUBLIC_KEY', 'auth/jwt_public_key'),
    jwtPrivateKey: () => memo('jwtPrivateKey', async () =>
      segredo(env.JWT_PRIVATE_KEY_SECRET_ARN || (await parametro('auth/jwt_private_key_secret_arn')))),
    /** Credenciais do banco fiapx_auth. DB_HOST/DB_PORT sobrescrevem o segredo (ex.: "mysql" dentro do compose). */
    database: () => memo('database', async () => {
      const arn = env.DB_SECRET_ARN || (await parametro('db/auth/secret_arn'));
      const s = JSON.parse(await segredo(arn));
      return {
        host: env.DB_HOST || s.host,
        port: Number(env.DB_PORT || s.port || 3306),
        user: s.username,
        password: s.password,
        database: s.dbname,
      };
    }),
  };
}

module.exports = { createConfig };
