#!/usr/bin/env node
'use strict';

/**
 * Servidor HTTP local que imita o API Gateway (HTTP API, payload 2.0) na frente das Lambdas, para
 * desenvolver o front-end e testar o fluxo sem AWS.
 *
 *   FIAPX_ENV=local AWS_ENDPOINT_URL=http://localhost:4566 npm run dev    # http://localhost:3001
 *
 * Como no API Gateway: PUT /api/auth/password passa pelo authorizer (401 sem header, 403 com token
 * inválido) e o contexto dele chega à Lambda em requestContext.authorizer.lambda.
 * Também expõe GET /api/auth/_authorize para outros serviços locais validarem um token.
 */
const http = require('node:http');
const crypto = require('node:crypto');

const handlers = {
  register: () => require('../src/handlers/register').handler,
  login: () => require('../src/handlers/login').handler,
  password: () => require('../src/handlers/password').handler,
  authorizer: () => require('../src/handlers/authorizer').handler,
};

const ROTAS = {
  'POST /api/auth/register': { lambda: 'register' },
  'POST /api/auth/login': { lambda: 'login' },
  'POST /api/auth/password/forgot': { lambda: 'password' },
  'POST /api/auth/password/reset/verify': { lambda: 'password' },
  'POST /api/auth/password/reset': { lambda: 'password' },
  'PUT /api/auth/password': { lambda: 'password', autenticada: true },
};

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    req.on('data', (p) => partes.push(p));
    req.on('end', () => resolve(Buffer.concat(partes).toString('utf8')));
    req.on('error', reject);
  });
}

function enviar(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

async function atender(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const routeKey = `${req.method} ${url.pathname}`;
  const headers = Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const event = {
    version: '2.0',
    routeKey,
    rawPath: url.pathname,
    headers,
    body: await lerCorpo(req),
    isBase64Encoded: false,
    requestContext: { requestId: crypto.randomUUID(), http: { method: req.method, path: url.pathname } },
  };

  if (routeKey === 'GET /api/auth/_authorize' || ROTAS[routeKey]?.autenticada) {
    if (!headers.authorization) return enviar(res, 401, { message: 'Unauthorized' });
    const r = await handlers.authorizer()(event);
    if (!r.isAuthorized) return enviar(res, 403, { message: 'Forbidden' });
    if (routeKey === 'GET /api/auth/_authorize') return enviar(res, 200, r.context);
    event.requestContext.authorizer = { lambda: r.context };
  }

  const rota = ROTAS[routeKey];
  if (!rota) return enviar(res, 404, { message: 'Not Found' });
  const r = await handlers[rota.lambda]()(event);
  return enviar(res, r.statusCode, r.body, r.headers);
}

const porta = Number(process.env.PORT || 3001);
http.createServer((req, res) => {
  atender(req, res).catch((e) => enviar(res, 500, { message: e.message }));
}).listen(porta, () => {
  console.log(`fiapx-auth local em http://localhost:${porta} (rotas: ${Object.keys(ROTAS).join(', ')})`);
});
