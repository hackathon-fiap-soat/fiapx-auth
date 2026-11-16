'use strict';

const { log, correlationId } = require('./http');
const { getUseCases } = require('../infrastructure/container');
const { InvalidAccessTokenError } = require('../domain/errors');

/**
 * Lambda Authorizer (REQUEST, payload 2.0, respostas simples, cache de 300 s no API Gateway).
 *
 * - Header Authorization ausente: o API Gateway responde 401 sem chamar esta função (identity source).
 * - Token inválido ou expirado: isAuthorized=false → o API Gateway responde 403.
 * - Token válido: o contexto (user_id, email, name) vira os headers x-user-* do video-api.
 */
exports.handler = async (event) => {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization;
  try {
    const context = await getUseCases().authorizeRequest({ authorization });
    return { isAuthorized: true, context };
  } catch (e) {
    if (!(e instanceof InvalidAccessTokenError)) {
      // Falha de infraestrutura (ex.: SSM fora): nega o acesso e registra para alerta.
      log('error', 'falha no authorizer', { correlation_id: correlationId(event), error: e.message });
    } else {
      log('info', 'token recusado', { correlation_id: correlationId(event), motivo: e.message });
    }
    return { isAuthorized: false };
  }
};
