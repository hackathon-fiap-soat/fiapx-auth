'use strict';

const { httpHandler, resposta, corpo, log } = require('./http');
const { getUseCases } = require('../infrastructure/container');
const { InvalidAccessTokenError } = require('../domain/errors');

const ACEITO = 'Se o e-mail estiver cadastrado, você receberá as instruções em instantes.';

/** Usuário autenticado, repassado pelo authorizer no contexto (payload 2.0, respostas simples). */
function usuarioAutenticado(event) {
  const ctx = event.requestContext && event.requestContext.authorizer && event.requestContext.authorizer.lambda;
  if (!ctx || !ctx.user_id) throw new InvalidAccessTokenError('rota sem contexto do authorizer');
  return ctx.user_id;
}

const rotas = {
  /** Sempre 202, exista ou não o e-mail. */
  'POST /api/auth/password/forgot': async (event, { correlationId }) => {
    const { email } = corpo(event);
    const resultado = await getUseCases().requestPasswordReset({ email, correlationId });
    log('info', 'pedido de redefinição', { correlation_id: correlationId, resultado });
    return resposta(202, { message: ACEITO });
  },

  'POST /api/auth/password/reset/verify': async (event) => {
    const { token } = corpo(event);
    return resposta(200, await getUseCases().verifyResetToken({ token }));
  },

  'POST /api/auth/password/reset': async (event, { correlationId }) => {
    const { token, password } = corpo(event);
    return resposta(200, await getUseCases().resetPassword({ token, password, correlationId }));
  },

  'PUT /api/auth/password': async (event, { correlationId }) => {
    const userId = usuarioAutenticado(event);
    const { current_password: currentPassword, new_password: newPassword } = corpo(event);
    await getUseCases().changePassword({ userId, currentPassword, newPassword, correlationId });
    return { statusCode: 204, headers: {}, body: '' };
  },
};

/** Uma Lambda para as quatro rotas de senha (ADR-017); o roteamento usa o routeKey do API Gateway. */
exports.handler = httpHandler('password', async (event, ctx) => {
  const rota = rotas[event.routeKey];
  if (!rota) return resposta(404, { message: 'Rota não encontrada.' });
  return rota(event, ctx);
});

exports.ROTAS = Object.keys(rotas);
