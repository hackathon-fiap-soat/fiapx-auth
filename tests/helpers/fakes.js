'use strict';

const crypto = require('node:crypto');
const { createUseCases } = require('../../src/application/use-cases');
const { jwtIssuer, jwtVerifier, secureTokenGenerator, uuidV7 } = require('../../src/infrastructure/security');
const { RegistrationRejectedError } = require('../../src/domain/errors');
const { PasswordResetToken } = require('../../src/domain/password-reset-token');

/** Par de chaves RSA para os testes (gerado uma vez por processo). */
let chaves;
function chavesRsa() {
  chaves = chaves || crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return chaves;
}

/** Repositórios em memória com a mesma semântica dos de MySQL. */
function memoria() {
  const users = new Map();
  const tokens = new Map();
  const userRepo = {
    async findByEmail(email) {
      return [...users.values()].find((u) => u.email.valor === email.valor) || null;
    },
    async findById(id) {
      return users.get(id) || null;
    },
    async create(user) {
      if ([...users.values()].some((u) => u.email.valor === user.email.valor)) throw new RegistrationRejectedError();
      users.set(user.id, user);
    },
    async updatePassword(userId, hash) {
      users.get(userId).passwordHash = hash;
    },
  };
  const tokenRepo = {
    async lastIssuedAt(userId) {
      const datas = [...tokens.values()].filter((t) => t.userId === userId).map((t) => t.createdAt.getTime());
      return datas.length ? new Date(Math.max(...datas)) : null;
    },
    async invalidateActive(userId, agora) {
      for (const t of tokens.values()) {
        if (t.userId === userId && t.usedAt === null && t.expiresAt > agora) t.usedAt = agora;
      }
    },
    async save(t) {
      tokens.set(t.id, new PasswordResetToken({ ...t }));
    },
    async findByHash(hash) {
      return [...tokens.values()].find((t) => t.tokenHash === hash) || null;
    },
    async findByHashForUpdate(hash) {
      return this.findByHash(hash);
    },
    async markUsed(id, agora) {
      tokens.get(id).usedAt = agora;
    },
  };
  return { users, tokens, userRepo, tokenRepo };
}

/** Hasher rápido e determinístico (o bcrypt real é testado à parte). */
const hasherFake = {
  hash: async (plain) => `hash:${plain}`,
  verify: async (plain, hash) => hash === `hash:${plain}`,
};

/** Casos de uso com fakes, relógio controlável e notificações capturadas. */
function montar({ agora = new Date('2026-11-16T12:00:00Z') } = {}) {
  const m = memoria();
  const relogio = { atual: agora, now() { return new Date(this.atual.getTime()); } };
  const publicadas = [];
  const { privateKey, publicKey } = chavesRsa();
  const useCases = createUseCases({
    users: m.userRepo,
    resetTokens: m.tokenRepo,
    transactions: { run: (fn) => fn({ users: m.userRepo, resetTokens: m.tokenRepo }) },
    hasher: hasherFake,
    tokenIssuer: jwtIssuer(async () => privateKey),
    tokenVerifier: jwtVerifier(async () => publicKey),
    secureTokens: secureTokenGenerator(),
    notifications: { publish: async (e) => publicadas.push(e) },
    clock: relogio,
    ids: { next: () => uuidV7(relogio.atual.getTime()) },
    config: { webUrl: async () => 'http://localhost:5173/' },
  });
  return { useCases, relogio, publicadas, ...m };
}

/** Extrai o token do action_url de um PASSWORD_RESET. */
function tokenDoLink(envelope) {
  return new URL(envelope.payload.action_url).searchParams.get('token');
}

module.exports = { montar, chavesRsa, hasherFake, tokenDoLink };
