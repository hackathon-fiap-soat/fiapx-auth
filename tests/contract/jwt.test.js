'use strict';

/**
 * Contract test do JWT: o verificador do authorizer aceita e recusa exatamente os tokens definidos em
 * fiapx-docs/contracts/jwt/vetores.json. O fiapx-video-api (Laravel) roda os mesmos vetores, o que garante
 * que os dois validam o token do mesmo jeito.
 */
const fs = require('node:fs');
const path = require('node:path');
const { jwtVerifier, ISSUER, AUDIENCE, TOLERANCIA_S } = require('../../src/infrastructure/security');
const { InvalidAccessTokenError } = require('../../src/domain/errors');

const CONTRATOS = path.resolve(process.env.CONTRACTS_DIR || path.join(__dirname, '..', '..', '..', 'fiapx-docs', 'contracts'));
const DIR = path.join(CONTRATOS, 'jwt');
const dados = JSON.parse(fs.readFileSync(path.join(DIR, 'vetores.json'), 'utf8'));
const chave = fs.readFileSync(path.join(DIR, dados.chave_publica), 'utf8');
const verificador = jwtVerifier(async () => chave);

describe('contrato do JWT (vetores do fiapx-docs)', () => {
  it('as regras do contrato batem com as do verificador', () => {
    expect(dados.regras).toMatchObject({ alg: 'RS256', iss: ISSUER, aud: AUDIENCE, tolerancia_relogio_s: TOLERANCIA_S });
  });

  it('tem vetores válidos e inválidos', () => {
    expect(dados.vetores.filter((v) => v.valido)).not.toHaveLength(0);
    expect(dados.vetores.filter((v) => !v.valido).length).toBeGreaterThanOrEqual(10);
  });

  it.each(dados.vetores.map((v) => [v.nome, v]))('%s', async (_, v) => {
    if (v.valido) {
      const claims = await verificador.verify(v.token);
      expect({ user_id: claims.sub, email: claims.email, name: claims.name }).toEqual(v.contexto);
    } else {
      await expect(verificador.verify(v.token)).rejects.toThrow(InvalidAccessTokenError);
    }
  });
});
