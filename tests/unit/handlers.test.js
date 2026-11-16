'use strict';

jest.mock('../../src/infrastructure/container', () => ({ getUseCases: jest.fn() }));

const { getUseCases } = require('../../src/infrastructure/container');
const { montar, tokenDoLink } = require('../helpers/fakes');
const register = require('../../src/handlers/register').handler;
const login = require('../../src/handlers/login').handler;
const password = require('../../src/handlers/password').handler;
const authorizer = require('../../src/handlers/authorizer').handler;

const MARIA = { name: 'Maria Silva', email: 'maria.silva@example.com', password: 'Senha-forte-123!' };
const evento = (routeKey, body, extra = {}) => ({
  version: '2.0', routeKey, headers: {}, body: body === undefined ? undefined : JSON.stringify(body), ...extra,
});
const json = (r) => (r.body ? JSON.parse(r.body) : undefined);

let ctx;
beforeEach(() => {
  ctx = montar();
  getUseCases.mockReturnValue(ctx.useCases);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function token() {
  await register(evento('POST /api/auth/register', MARIA));
  return json(await login(evento('POST /api/auth/login', MARIA))).access_token;
}

describe('register', () => {
  it('201 com o usuário e header x-correlation-id', async () => {
    const r = await register(evento('POST /api/auth/register', MARIA));
    expect(r.statusCode).toBe(201);
    expect(json(r)).toMatchObject({ name: 'Maria Silva', email: MARIA.email });
    expect(r.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('repassa o x-correlation-id recebido', async () => {
    const id = '0193a1b2-9001-7a00-9b00-000000000102';
    const r = await register(evento('POST /api/auth/register', MARIA, { headers: { 'x-correlation-id': id } }));
    expect(r.headers['x-correlation-id']).toBe(id);
  });

  it('422 com erros por campo', async () => {
    const r = await register(evento('POST /api/auth/register', { name: '', email: 'x', password: 'a' }));
    expect(r.statusCode).toBe(422);
    expect(json(r)).toMatchObject({ message: 'Os dados informados são inválidos.', errors: { name: expect.any(Array) } });
  });

  it('422 genérico e sem errors para e-mail repetido', async () => {
    await register(evento('POST /api/auth/register', MARIA));
    const r = await register(evento('POST /api/auth/register', MARIA));
    expect(r.statusCode).toBe(422);
    expect(json(r)).toEqual({ message: 'Não foi possível concluir o cadastro.' });
  });

  it.each([undefined, 'não é json', '[1]', 'null'])('422 para corpo %p', async (body) => {
    const r = await register({ routeKey: 'POST /api/auth/register', headers: {}, body });
    expect(r.statusCode).toBe(422);
    expect(json(r).message).toBe('Envie os dados em JSON.');
  });

  it('aceita corpo em base64', async () => {
    const body = Buffer.from(JSON.stringify(MARIA)).toString('base64');
    const r = await register({ routeKey: 'POST /api/auth/register', headers: {}, body, isBase64Encoded: true });
    expect(r.statusCode).toBe(201);
  });

  it('500 sem detalhes em erro inesperado, registrado em log', async () => {
    getUseCases.mockReturnValue({ registerUser: async () => { throw new Error('banco fora'); } });
    const r = await register(evento('POST /api/auth/register', MARIA));
    expect(r.statusCode).toBe(500);
    expect(r.body).not.toContain('banco fora');
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('banco fora'));
  });
});

describe('login', () => {
  it('200 com o token', async () => {
    await register(evento('POST /api/auth/register', MARIA));
    const r = await login(evento('POST /api/auth/login', MARIA));
    expect(r.statusCode).toBe(200);
    expect(json(r)).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
  });

  it('401 genérico para credenciais inválidas', async () => {
    const r = await login(evento('POST /api/auth/login', { email: MARIA.email, password: 'Errada-1!' }));
    expect(r.statusCode).toBe(401);
    expect(json(r)).toEqual({ message: 'E-mail ou senha inválidos.' });
  });

  it('nunca registra a senha em log', async () => {
    await login(evento('POST /api/auth/login', MARIA));
    const logs = console.log.mock.calls.flat().join('\n');
    expect(logs).not.toContain(MARIA.password);
  });
});

describe('password', () => {
  it('forgot responde 202 exista ou não o e-mail', async () => {
    await register(evento('POST /api/auth/register', MARIA));
    for (const email of [MARIA.email, 'ninguem@example.com']) {
      const r = await password(evento('POST /api/auth/password/forgot', { email }));
      expect(r.statusCode).toBe(202);
      expect(json(r).message).toContain('Se o e-mail estiver cadastrado');
    }
    expect(ctx.publicadas).toHaveLength(1);
    expect(console.log.mock.calls.flat().join('\n')).not.toContain(tokenDoLink(ctx.publicadas[0]));
  });

  it('verify e reset pelo link', async () => {
    await register(evento('POST /api/auth/register', MARIA));
    await password(evento('POST /api/auth/password/forgot', { email: MARIA.email }));
    const t = tokenDoLink(ctx.publicadas[0]);
    const v = await password(evento('POST /api/auth/password/reset/verify', { token: t }));
    expect(v.statusCode).toBe(200);
    expect(json(v).email_masked).toBe('m***a@example.com');
    const r = await password(evento('POST /api/auth/password/reset', { token: t, password: 'Nova-senha-456!' }));
    expect(r.statusCode).toBe(200);
    expect(json(r).token_type).toBe('Bearer');
    const de_novo = await password(evento('POST /api/auth/password/reset', { token: t, password: 'Outra-senha-7!' }));
    expect(de_novo.statusCode).toBe(422);
    expect(json(de_novo)).toEqual({ message: 'O link de redefinição é inválido ou expirou. Peça um novo.' });
  });

  it('PUT troca a senha com o contexto do authorizer (204)', async () => {
    await register(evento('POST /api/auth/register', MARIA));
    const user = [...ctx.users.values()][0];
    const r = await password(evento('PUT /api/auth/password',
      { current_password: MARIA.password, new_password: 'Nova-senha-456!' },
      { requestContext: { authorizer: { lambda: { user_id: user.id } } } }));
    expect(r.statusCode).toBe(204);
    expect(r.body).toBe('');
  });

  it('PUT sem contexto do authorizer → 401', async () => {
    const r = await password(evento('PUT /api/auth/password', { current_password: 'a', new_password: 'b' }));
    expect(r.statusCode).toBe(401);
    expect(json(r)).toEqual({ message: 'Unauthorized' });
  });

  it('rota desconhecida → 404', async () => {
    const r = await password(evento('GET /api/auth/password', undefined));
    expect(r.statusCode).toBe(404);
  });
});

describe('authorizer', () => {
  it('autoriza token válido e devolve o contexto', async () => {
    const t = await token();
    const r = await authorizer({ headers: { authorization: `Bearer ${t}` } });
    expect(r).toEqual({ isAuthorized: true, context: { user_id: expect.any(String), email: MARIA.email, name: 'Maria Silva' } });
  });

  it('aceita o header com A maiúsculo', async () => {
    const t = await token();
    await expect(authorizer({ headers: { Authorization: `Bearer ${t}` } })).resolves.toMatchObject({ isAuthorized: true });
  });

  it.each([{}, { headers: {} }, { headers: { authorization: 'Bearer invalido' } }])('nega %p', async (ev) => {
    await expect(authorizer(ev)).resolves.toEqual({ isAuthorized: false });
  });

  it('nega e registra erro quando a infraestrutura falha', async () => {
    getUseCases.mockReturnValue({ authorizeRequest: async () => { throw new Error('SSM fora'); } });
    await expect(authorizer({ headers: { authorization: 'Bearer x' } })).resolves.toEqual({ isAuthorized: false });
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('SSM fora'));
  });
});
