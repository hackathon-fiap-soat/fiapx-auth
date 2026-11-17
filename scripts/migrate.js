#!/usr/bin/env node
'use strict';

/**
 * Aplica as migrations no ambiente local. As credenciais vêm do segredo fiapx/<env>/db/auth:
 *   FIAPX_ENV=local AWS_ENDPOINT_URL=http://localhost:4566 npm run migrate
 * Na AWS, quem aplica é a Lambda `migrate`, invocada pelo deploy.yml.
 */
const { createConfig } = require('../src/infrastructure/config');
const { migrar } = require('../src/infrastructure/migrations');

if (require.main === module) {
  createConfig().database()
    .then((db) => migrar(db))
    .catch((e) => {
      console.error(`falha nas migrations: ${e.message}`);
      process.exit(1);
    });
}

module.exports = { migrar };
