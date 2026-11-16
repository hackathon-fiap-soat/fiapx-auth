'use strict';

/**
 * Contract test: as mensagens que o fiapx-auth produz validam contra os JSON Schemas do fiapx-docs
 * (produtor estrito). Os schemas são lidos de CONTRACTS_DIR (padrão: ../fiapx-docs/contracts, o clone ao
 * lado; no CI, o workflow faz checkout do fiapx-docs nesse caminho).
 */
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { montar, tokenDoLink } = require('../helpers/fakes');
const { passwordEmail } = require('../../src/application/send-notification');

const DIR = path.resolve(process.env.CONTRACTS_DIR || path.join(__dirname, '..', '..', '..', 'fiapx-docs', 'contracts'));

function validador() {
  if (!fs.existsSync(path.join(DIR, 'envelope.schema.json'))) {
    throw new Error(`Schemas não encontrados em ${DIR}. Clone o fiapx-docs ao lado ou defina CONTRACTS_DIR.`);
  }
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  for (const f of fs.readdirSync(DIR).filter((n) => n.endsWith('.schema.json'))) {
    ajv.addSchema(JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')), f);
  }
  return ajv.getSchema('send-notification.v1.schema.json');
}

const MARIA = { name: 'Maria Silva', email: 'maria.silva@example.com', password: 'Senha-forte-123!' };
const CORR = '0193a1b2-9001-7a00-9b00-000000000102';

describe('contrato SendNotification v1', () => {
  const valida = validador();
  const ok = (msg) => {
    const r = valida(msg);
    if (!r) throw new Error(JSON.stringify(valida.errors, null, 2));
  };

  it('PASSWORD_RESET e PASSWORD_CHANGED produzidos pelos casos de uso são válidos', async () => {
    const { useCases, publicadas } = montar();
    await useCases.registerUser(MARIA);
    await useCases.requestPasswordReset({ email: MARIA.email, correlationId: CORR });
    await useCases.resetPassword({ token: tokenDoLink(publicadas[0]), password: 'Nova-senha-456!', correlationId: CORR });
    expect(publicadas.map((m) => m.payload.template)).toEqual(['PASSWORD_RESET', 'PASSWORD_CHANGED']);
    publicadas.forEach(ok);
  });

  it('o exemplo oficial do fiapx-docs continua válido', () => {
    ok(JSON.parse(fs.readFileSync(path.join(DIR, 'examples', 'send-notification.v1--password-reset.json'), 'utf8')));
  });

  it('o schema rejeita PASSWORD_RESET sem action_url e com saga_id preenchido', () => {
    const deps = { ids: { next: () => '0193a1b2-9001-7a00-9b00-000000000101' }, clock: { now: () => new Date() } };
    const user = { name: 'M', email: 'm@example.com' };
    expect(valida(passwordEmail(deps, { template: 'PASSWORD_RESET', user, correlationId: CORR }))).toBe(false);
    const comSaga = passwordEmail(deps, { template: 'PASSWORD_CHANGED', user, correlationId: CORR });
    comSaga.saga_id = CORR;
    expect(valida(comSaga)).toBe(false);
  });
});
