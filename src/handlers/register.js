'use strict';

const { httpHandler, resposta, corpo } = require('./http');
const { getUseCases } = require('../infrastructure/container');

/** POST /api/auth/register → 201 {id, name, email} */
exports.handler = httpHandler('register', async (event) => {
  const { name, email, password } = corpo(event);
  const user = await getUseCases().registerUser({ name, email, password });
  return resposta(201, user);
});
