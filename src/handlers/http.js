'use strict';

const {
  MENSAGEM_VALIDACAO,
  ValidationError,
  RegistrationRejectedError,
  InvalidCredentialsError,
  InvalidResetTokenError,
  InvalidAccessTokenError,
} = require('../domain/errors');
const { uuidV7 } = require('../infrastructure/security');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Campos que nunca podem aparecer em log (senhas, token de redefinição, JWT, link com token).
const SENSIVEIS = /password|token|authorization|action_url/i;

/** Log em JSON, uma linha por evento, com correlation_id (lido pelo New Relic). */
function log(nivel, mensagem, extra = {}) {
  const limpo = Object.fromEntries(Object.entries(extra).filter(([k]) => !SENSIVEIS.test(k)));
  const linha = JSON.stringify({ level: nivel, message: mensagem, service: 'fiapx-auth', ...limpo });
  (nivel === 'error' ? console.error : console.log)(linha);
}

function resposta(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

/** Corpo JSON do evento do API Gateway (payload 2.0). Corpo ausente ou inválido vira 422. */
function corpo(event) {
  if (!event.body) throw new ValidationError({}, 'Envie os dados em JSON.');
  const texto = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  try {
    const dados = JSON.parse(texto);
    if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) throw new Error('não é objeto');
    return dados;
  } catch {
    throw new ValidationError({}, 'Envie os dados em JSON.');
  }
}

function correlationId(event) {
  const h = (event.headers && (event.headers['x-correlation-id'] || event.headers['X-Correlation-Id'])) || '';
  return UUID.test(h) ? h.toLowerCase() : uuidV7();
}

/** Converte os erros conhecidos para o formato do contrato; o resto vira 500 sem detalhes. */
function erroParaResposta(e, ctx) {
  if (e instanceof ValidationError) {
    const body = { message: e.message || MENSAGEM_VALIDACAO };
    if (Object.keys(e.errors).length > 0) body.errors = e.errors;
    return resposta(422, body);
  }
  if (e instanceof RegistrationRejectedError || e instanceof InvalidResetTokenError) return resposta(422, { message: e.message });
  if (e instanceof InvalidCredentialsError) return resposta(401, { message: e.message });
  if (e instanceof InvalidAccessTokenError) return resposta(401, { message: 'Unauthorized' });
  log('error', 'erro inesperado', { ...ctx, error: e.message, stack: e.stack });
  return resposta(500, { message: 'Não foi possível processar a solicitação. Tente novamente.' });
}

/**
 * Envolve um handler HTTP: correlation_id, log de entrada/saída e tradução de erros.
 * @param {string} nome
 * @param {(event: object, ctx: {correlationId: string}) => Promise<object>} fn
 */
function httpHandler(nome, fn) {
  return async (event) => {
    const ctx = { handler: nome, route: event.routeKey, correlation_id: correlationId(event) };
    const inicio = Date.now();
    let res;
    try {
      res = await fn(event, { correlationId: ctx.correlation_id });
    } catch (e) {
      res = erroParaResposta(e, ctx);
    }
    res.headers = { ...res.headers, 'x-correlation-id': ctx.correlation_id };
    log('info', 'requisição atendida', { ...ctx, status: res.statusCode, duration_ms: Date.now() - inicio });
    return res;
  };
}

module.exports = { httpHandler, resposta, corpo, log, correlationId };
