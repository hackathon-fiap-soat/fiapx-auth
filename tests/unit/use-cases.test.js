'use strict';

const jwt = require('jsonwebtoken');
const { montar, tokenDoLink } = require('../helpers/fakes');
const {
  ValidationError,
  RegistrationRejectedError,
  InvalidCredentialsError,
  InvalidResetTokenError,
  InvalidAccessTokenError,
} = require('../../src/domain/errors');

const MARIA = { name: 'Maria Silva', email: 'Maria.Silva@example.com', password: 'Senha-forte-123!' };
const CORR = '0193a1b2-9001-7a00-9b00-000000000102';

async function comMaria() {
  const ctx = montar();
  const maria = await ctx.useCases.registerUser(MARIA);
  return { ...ctx, maria };
}

describe('registerUser', () => {
  it('cria o usuário com e-mail normalizado e senha só como hash', async () => {
    const { useCases, users } = montar();
    const user = await useCases.registerUser(MARIA);
    expect(user).toEqual({ id: expect.any(String), name: 'Maria Silva', email: 'maria.silva@example.com' });
    expect(users.get(user.id).passwordHash).toBe('hash:Senha-forte-123!');
  });

  it('junta os erros de todos os campos', async () => {
    const { useCases } = montar();
    await expect(useCases.registerUser({ name: '', email: 'x', password: 'fraca' })).rejects.toMatchObject({
      errors: { name: expect.any(Array), email: expect.any(Array), password: expect.any(Array) },
    });
  });

  it('recusa e-mail repetido com erro genérico, sem citar o e-mail', async () => {
    const { useCases } = await comMaria();
    const erro = await useCases.registerUser({ ...MARIA, email: 'maria.silva@EXAMPLE.com' }).catch((e) => e);
    expect(erro).toBeInstanceOf(RegistrationRejectedError);
    expect(erro.message).toBe('Não foi possível concluir o cadastro.');
  });
});

describe('authenticateUser', () => {
  it('devolve um JWT RS256 com as claims do contrato', async () => {
    const { useCases, maria } = await comMaria();
    const r = await useCases.authenticateUser({ email: 'maria.silva@example.com', password: MARIA.password });
    expect(r).toMatchObject({ token_type: 'Bearer', expires_in: 3600 });
    const claims = jwt.decode(r.access_token, { complete: true });
    expect(claims.header.alg).toBe('RS256');
    expect(claims.payload).toMatchObject({
      sub: maria.id, email: 'maria.silva@example.com', name: 'Maria Silva', iss: 'fiapx-auth', aud: 'fiapx-api',
    });
    expect(claims.payload.exp - claims.payload.iat).toBe(3600);
  });

  it.each([
    ['senha errada', 'maria.silva@example.com', 'Outra-senha-1!'],
    ['e-mail inexistente', 'ninguem@example.com', MARIA.password],
  ])('mesma resposta para %s', async (_, email, password) => {
    const { useCases } = await comMaria();
    await expect(useCases.authenticateUser({ email, password })).rejects.toThrow(InvalidCredentialsError);
  });

  it('exige e-mail e senha', async () => {
    const { useCases } = montar();
    await expect(useCases.authenticateUser({ email: 'a@b.com' })).rejects.toThrow(ValidationError);
  });
});

describe('authorizeRequest', () => {
  it('aceita o token do login e devolve o contexto', async () => {
    const { useCases, maria } = await comMaria();
    const { access_token: token } = await useCases.authenticateUser({ email: MARIA.email, password: MARIA.password });
    await expect(useCases.authorizeRequest({ authorization: `Bearer ${token}` })).resolves.toEqual({
      user_id: maria.id, email: 'maria.silva@example.com', name: 'Maria Silva',
    });
  });

  it.each([undefined, '', 'Basic abc', 'Bearer', 'Bearer a.b.c'])('recusa %p', async (authorization) => {
    const { useCases } = montar();
    await expect(useCases.authorizeRequest({ authorization })).rejects.toThrow(InvalidAccessTokenError);
  });

  it('recusa token assinado com outra chave, de outro emissor ou expirado', async () => {
    const crypto = require('node:crypto');
    const { useCases } = await comMaria();
    const outra = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const { chavesRsa } = require('../helpers/fakes');
    const base = { email: 'x@y.com', name: 'X' };
    const opcoes = { algorithm: 'RS256', subject: 'u', audience: 'fiapx-api', issuer: 'fiapx-auth' };
    const tokens = [
      jwt.sign(base, outra, opcoes),
      jwt.sign(base, chavesRsa().privateKey, { ...opcoes, issuer: 'outro' }),
      jwt.sign(base, chavesRsa().privateKey, { ...opcoes, audience: 'outra-api' }),
      jwt.sign({ ...base, exp: Math.floor(Date.now() / 1000) - 10 }, chavesRsa().privateKey, opcoes),
      jwt.sign({ name: 'X' }, chavesRsa().privateKey, opcoes),
    ];
    for (const t of tokens) {
      await expect(useCases.authorizeRequest({ authorization: `Bearer ${t}` })).rejects.toThrow(InvalidAccessTokenError);
    }
  });
});

describe('requestPasswordReset', () => {
  it('gera token, guarda só o hash e publica PASSWORD_RESET com o link', async () => {
    const { useCases, tokens, publicadas, maria } = await comMaria();
    await expect(useCases.requestPasswordReset({ email: MARIA.email, correlationId: CORR })).resolves.toBe('enviado');
    expect(publicadas).toHaveLength(1);
    const msg = publicadas[0];
    expect(msg).toMatchObject({
      type: 'SendNotification', version: 1, saga_id: null, video_id: null, correlation_id: CORR,
      payload: { template: 'PASSWORD_RESET', recipient_email: 'maria.silva@example.com', recipient_name: 'Maria Silva' },
    });
    expect(msg.payload.action_url).toMatch(/^http:\/\/localhost:5173\/redefinir-senha\?token=[A-Za-z0-9_-]{43}$/);
    const salvo = [...tokens.values()][0];
    expect(salvo.userId).toBe(maria.id);
    expect(salvo.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(salvo.tokenHash).not.toContain(tokenDoLink(msg));
  });

  it('não faz nada (sem erro) para e-mail sem cadastro', async () => {
    const { useCases, publicadas } = await comMaria();
    await expect(useCases.requestPasswordReset({ email: 'ninguem@example.com', correlationId: CORR })).resolves.toBe('ignorado');
    expect(publicadas).toHaveLength(0);
  });

  it('envia no máximo um e-mail a cada 2 minutos e invalida o link anterior', async () => {
    const { useCases, publicadas, relogio } = await comMaria();
    await useCases.requestPasswordReset({ email: MARIA.email, correlationId: CORR });
    await expect(useCases.requestPasswordReset({ email: MARIA.email, correlationId: CORR })).resolves.toBe('ignorado');
    relogio.atual = new Date(relogio.atual.getTime() + 120_000);
    await useCases.requestPasswordReset({ email: MARIA.email, correlationId: CORR });
    expect(publicadas).toHaveLength(2);
    await expect(useCases.verifyResetToken({ token: tokenDoLink(publicadas[0]) })).rejects.toThrow(InvalidResetTokenError);
    await expect(useCases.verifyResetToken({ token: tokenDoLink(publicadas[1]) })).resolves.toBeDefined();
  });

  it('valida o formato do e-mail', async () => {
    const { useCases } = montar();
    await expect(useCases.requestPasswordReset({ email: 'invalido' })).rejects.toThrow(ValidationError);
  });
});

describe('verifyResetToken e resetPassword', () => {
  async function comLink() {
    const ctx = await comMaria();
    await ctx.useCases.requestPasswordReset({ email: MARIA.email, correlationId: CORR });
    return { ...ctx, token: tokenDoLink(ctx.publicadas[0]) };
  }

  it('verify devolve e-mail mascarado e expiração', async () => {
    const { useCases, token } = await comLink();
    await expect(useCases.verifyResetToken({ token })).resolves.toEqual({
      email_masked: 'm***a@example.com', expires_at: '2026-11-16T12:30:00Z',
    });
  });

  it.each([undefined, 'curto', '!'.repeat(43), 'a'.repeat(43)])('verify recusa token %p', async (token) => {
    const { useCases } = await comLink();
    await expect(useCases.verifyResetToken({ token })).rejects.toThrow(InvalidResetTokenError);
  });

  it('verify recusa token expirado', async () => {
    const { useCases, token, relogio } = await comLink();
    relogio.atual = new Date(relogio.atual.getTime() + 30 * 60_000);
    await expect(useCases.verifyResetToken({ token })).rejects.toThrow(InvalidResetTokenError);
  });

  it('reset troca a senha, devolve JWT, avisa a troca e só funciona uma vez', async () => {
    const { useCases, token, publicadas, users, maria } = await comLink();
    const r = await useCases.resetPassword({ token, password: 'Nova-senha-456!', correlationId: CORR });
    expect(r.token_type).toBe('Bearer');
    expect(users.get(maria.id).passwordHash).toBe('hash:Nova-senha-456!');
    expect(publicadas[1]).toMatchObject({ saga_id: null, payload: { template: 'PASSWORD_CHANGED' } });
    expect(publicadas[1].payload.action_url).toBeUndefined();
    await expect(useCases.resetPassword({ token, password: 'Outra-senha-789!' })).rejects.toThrow(InvalidResetTokenError);
    await expect(useCases.authenticateUser({ email: MARIA.email, password: 'Nova-senha-456!' })).resolves.toBeDefined();
  });

  it('reset aplica a política e exige senha diferente da atual', async () => {
    const { useCases, token } = await comLink();
    await expect(useCases.resetPassword({ token, password: 'fraca' })).rejects.toMatchObject({ errors: { password: expect.any(Array) } });
    await expect(useCases.resetPassword({ token, password: MARIA.password })).rejects.toMatchObject({
      errors: { password: ['A nova senha deve ser diferente da atual.'] },
    });
  });

  it('reset recusa token de usuário removido', async () => {
    const { useCases, token, users } = await comLink();
    users.clear();
    await expect(useCases.verifyResetToken({ token })).rejects.toThrow(InvalidResetTokenError);
    await expect(useCases.resetPassword({ token, password: 'Nova-senha-456!' })).rejects.toThrow(InvalidResetTokenError);
  });
});

describe('changePassword', () => {
  it('troca a senha conferindo a atual e avisa por e-mail', async () => {
    const { useCases, maria, users, publicadas } = await comMaria();
    await useCases.changePassword({ userId: maria.id, currentPassword: MARIA.password, newPassword: 'Nova-senha-456!', correlationId: CORR });
    expect(users.get(maria.id).passwordHash).toBe('hash:Nova-senha-456!');
    expect(publicadas[0].payload.template).toBe('PASSWORD_CHANGED');
  });

  it.each([
    [{ currentPassword: 'Errada-123!', newPassword: 'Nova-senha-456!' }, 'current_password', 'A senha atual está incorreta.'],
    [{ currentPassword: MARIA.password, newPassword: MARIA.password }, 'new_password', 'A nova senha deve ser diferente da atual.'],
    [{ currentPassword: '', newPassword: 'Nova-senha-456!' }, 'current_password', 'Informe a senha atual.'],
  ])('recusa %o', async (entrada, campo, mensagem) => {
    const { useCases, maria } = await comMaria();
    await expect(useCases.changePassword({ userId: maria.id, ...entrada })).rejects.toMatchObject({ errors: { [campo]: [mensagem] } });
  });

  it('aplica a política na nova senha', async () => {
    const { useCases, maria } = await comMaria();
    await expect(useCases.changePassword({ userId: maria.id, currentPassword: MARIA.password, newPassword: 'fraca' }))
      .rejects.toMatchObject({ errors: { new_password: expect.any(Array) } });
  });

  it('usuário do token inexistente é tratado como token inválido', async () => {
    const { useCases } = montar();
    await expect(useCases.changePassword({ userId: 'x', currentPassword: 'a', newPassword: 'Nova-senha-456!' }))
      .rejects.toThrow(InvalidAccessTokenError);
  });
});
