'use strict';

const { httpHandler, resposta, corpo } = require('./http');
const { getUseCases } = require('../infrastructure/container');

/** POST /api/auth/login → 200 {access_token, token_type, expires_in} */
exports.handler = httpHandler('login', async (event) => {
  const { email, password } = corpo(event);
  return resposta(200, await getUseCases().authenticateUser({ email, password }));
});
