'use strict';

/**
 * Aplica as migrations de migrations/*.sql em ordem, uma única vez cada (tabela schema_migrations).
 * Usado pelo `npm run migrate` (ambiente local) e pela Lambda `migrate` (AWS), que o deploy invoca porque o
 * runner do GitHub não alcança o Aurora em subnet privada.
 */
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const PASTA = path.join(__dirname, '..', '..', 'migrations');

async function migrar(db, saida = console) {
  const conn = await mysql.createConnection({ ...db, multipleStatements: true, timezone: 'Z' });
  try {
    await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    const [feitas] = await conn.query('SELECT version FROM schema_migrations');
    const aplicadas = new Set(feitas.map((r) => r.version));
    const arquivos = fs.readdirSync(PASTA).filter((f) => f.endsWith('.sql')).sort();
    let novas = 0;
    for (const arquivo of arquivos) {
      if (aplicadas.has(arquivo)) continue;
      await conn.query(fs.readFileSync(path.join(PASTA, arquivo), 'utf8'));
      await conn.query('INSERT INTO schema_migrations (version) VALUES (?)', [arquivo]);
      saida.log(`migration aplicada: ${arquivo}`);
      novas++;
    }
    saida.log(`${novas} migration(s) nova(s); ${arquivos.length} no total.`);
  } finally {
    await conn.end();
  }
}

module.exports = { migrar };
