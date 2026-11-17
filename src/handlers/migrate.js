'use strict';

const { createConfig } = require('../infrastructure/config');
const { migrar } = require('../infrastructure/migrations');

/**
 * Lambda `migrate` (sem rota no API Gateway): o deploy.yml a invoca depois do terraform apply. Devolve as
 * linhas de log das migrations aplicadas; erro vira FunctionError, e o deploy falha.
 */
exports.handler = async (_event, _context, deps = { createConfig, migrar }) => {
  const linhas = [];
  const saida = { log: (m) => { linhas.push(m); console.log(JSON.stringify({ level: 'info', event: 'migration', message: m })); } };
  await deps.migrar(await deps.createConfig().database(), saida);
  return { ok: true, linhas };
};
