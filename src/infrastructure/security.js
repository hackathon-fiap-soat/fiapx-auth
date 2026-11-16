'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { InvalidAccessTokenError } = require('../domain/errors');

const ISSUER = 'fiapx-auth';
const AUDIENCE = 'fiapx-api';
const VALIDADE_S = 3600;
const TOLERANCIA_S = 30;

/** bcrypt com custo 12 (spec §8.3). */
function bcryptHasher(custo = 12) {
  return {
    hash: (plain) => bcrypt.hash(plain, custo),
    verify: (plain, hash) => bcrypt.compare(plain, hash),
  };
}

/** Emite JWT RS256 com a chave privada (lida do Secrets Manager só quando necessário). */
function jwtIssuer(chavePrivada, { validade = VALIDADE_S } = {}) {
  return {
    async issue(user) {
      const accessToken = jwt.sign(
        { email: user.email, name: user.name },
        await chavePrivada(),
        { algorithm: 'RS256', subject: user.id, issuer: ISSUER, audience: AUDIENCE, expiresIn: validade },
      );
      return { accessToken, expiresIn: validade };
    },
  };
}

/** Valida assinatura RS256, iss, aud e exp. Qualquer falha vira InvalidAccessTokenError. */
function jwtVerifier(chavePublica) {
  return {
    async verify(token) {
      const chave = await chavePublica();
      try {
        // Mesmas regras do fiapx-video-api (fiapx-docs/contracts/jwt): só RS256, iss, aud, exp obrigatório,
        // tolerância de 30 s e claims sub, email e name.
        const claims = jwt.verify(token, chave, {
          algorithms: ['RS256'], issuer: ISSUER, audience: AUDIENCE, clockTolerance: TOLERANCIA_S,
        });
        if (!claims.exp || !claims.sub || !claims.email || !claims.name) throw new Error('claims obrigatórias ausentes');
        return claims;
      } catch (e) {
        throw new InvalidAccessTokenError(e.message);
      }
    },
  };
}

/** Token de redefinição: 32 bytes aleatórios em base64url; no banco, só o SHA-256 (hex). */
function secureTokenGenerator() {
  const hashOf = (token) => crypto.createHash('sha256').update(token, 'utf8').digest('hex');
  return {
    generate() {
      const token = crypto.randomBytes(32).toString('base64url');
      return { token, hash: hashOf(token) };
    },
    hashOf,
  };
}

/** UUID v7 (RFC 9562): 48 bits de timestamp em ms + aleatório. Ordenável no tempo. */
function uuidV7(agora = Date.now()) {
  const b = crypto.randomBytes(16);
  const ms = BigInt(agora);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

module.exports = { bcryptHasher, jwtIssuer, jwtVerifier, secureTokenGenerator, uuidV7, ISSUER, AUDIENCE, VALIDADE_S, TOLERANCIA_S };
