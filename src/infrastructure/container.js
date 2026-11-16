'use strict';

const { createConfig } = require('./config');
const { createPool, mysqlUserRepository, mysqlResetTokenRepository, mysqlTransactionManager } = require('./mysql');
const { bcryptHasher, jwtIssuer, jwtVerifier, secureTokenGenerator, uuidV7 } = require('./security');
const { sqsNotificationPublisher } = require('./sqs-notification-publisher');
const { createUseCases } = require('../application/use-cases');

let config;
let poolPromise;
let useCases;

function getConfig() {
  config = config || createConfig();
  return config;
}

/** Pool criado na primeira requisição que precisa do banco e reaproveitado enquanto a Lambda estiver quente. */
function pool() {
  poolPromise = poolPromise || getConfig().database().then(createPool).catch((e) => {
    poolPromise = undefined;
    throw e;
  });
  return poolPromise;
}

/** Repositório que resolve o pool só quando um método é chamado (o authorizer nunca abre conexão). */
function preguicoso(fabrica) {
  return new Proxy({}, {
    get: (_, metodo) => async (...args) => fabrica(await pool())[metodo](...args),
  });
}

/** Liga as portas às implementações reais. */
function getUseCases() {
  if (useCases) return useCases;
  const cfg = getConfig();
  useCases = createUseCases({
    users: preguicoso(mysqlUserRepository),
    resetTokens: preguicoso(mysqlResetTokenRepository),
    transactions: { run: async (fn) => mysqlTransactionManager(await pool()).run(fn) },
    hasher: bcryptHasher(),
    tokenIssuer: jwtIssuer(cfg.jwtPrivateKey),
    tokenVerifier: jwtVerifier(cfg.jwtPublicKey),
    secureTokens: secureTokenGenerator(),
    notifications: sqsNotificationPublisher(cfg.notificationQueueUrl),
    clock: { now: () => new Date() },
    ids: { next: () => uuidV7() },
    config: { webUrl: cfg.webUrl },
  });
  return useCases;
}

/** Para testes de integração: fecha o pool e esquece o estado. */
async function reset() {
  if (poolPromise) await (await poolPromise).end().catch(() => {});
  config = undefined;
  poolPromise = undefined;
  useCases = undefined;
}

module.exports = { getUseCases, getConfig, reset };
