'use strict';

const { Email } = require('../../src/domain/email');
const { PasswordPolicy } = require('../../src/domain/password-policy');
const { User } = require('../../src/domain/user');
const { PasswordResetToken, VALIDADE_MS } = require('../../src/domain/password-reset-token');
const { ValidationError } = require('../../src/domain/errors');

describe('Email', () => {
  it('normaliza espaços e maiúsculas', () => {
    expect(Email.of('  Maria.Silva@Example.COM ').valor).toBe('maria.silva@example.com');
  });

  it.each([undefined, '', '   ', 'sem-arroba', 'a@b', 'a b@c.com', `${'a'.repeat(175)}@x.com`])('recusa %p', (v) => {
    expect(() => Email.of(v)).toThrow(ValidationError);
  });

  it('usa o nome do campo informado na mensagem', () => {
    try {
      Email.of('x', 'login');
    } catch (e) {
      expect(Object.keys(e.errors)).toEqual(['login']);
    }
  });

  it.each([
    ['maria.silva@example.com', 'm***a@example.com'],
    ['ab@example.com', 'a***@example.com'],
    ['a@example.com', 'a***@example.com'],
  ])('mascara %s como %s', (email, esperado) => {
    expect(Email.of(email).mascarado()).toBe(esperado);
    expect(String(Email.of(email))).toBe(email);
  });
});

describe('PasswordPolicy', () => {
  it('aceita senha com 8+ caracteres, maiúscula, número e símbolo', () => {
    expect(PasswordPolicy.violacoes('Senha-forte-1')).toEqual([]);
  });

  it.each([
    [undefined, 'Informe a senha.'],
    ['Ab1!', 'pelo menos 8'],
    ['senha-forte-1', 'maiúscula'],
    ['Senha-forte', 'número'],
    ['SenhaForte1', 'símbolo'],
    [`A1!${'a'.repeat(70)}`, 'no máximo 72'],
  ])('recusa %p (%s)', (senha, trecho) => {
    expect(PasswordPolicy.violacoes(senha).join(' ')).toContain(trecho);
  });

  it('conta bytes, não caracteres, no limite de 72 (limite do bcrypt)', () => {
    expect(PasswordPolicy.violacoes(`A1!${'é'.repeat(35)}`).join()).toContain('no máximo 72');
  });

  it('garantir lança no campo informado', () => {
    expect(() => PasswordPolicy.garantir('fraca', 'new_password')).toThrow(
      expect.objectContaining({ errors: expect.objectContaining({ new_password: expect.any(Array) }) }));
  });
});

describe('User', () => {
  it('normaliza o nome', () => {
    expect(User.nomeValido('  Maria   Silva ')).toBe('Maria Silva');
  });

  it.each([undefined, '', '   ', 'x'.repeat(121)])('recusa nome %p', (n) => {
    expect(() => User.nomeValido(n)).toThrow(ValidationError);
  });

  it('expõe só os dados públicos', () => {
    const u = new User({ id: '1', name: 'M', email: Email.of('m@x.com'), passwordHash: 'h' });
    expect(u.publico()).toEqual({ id: '1', name: 'M', email: 'm@x.com' });
  });
});

describe('PasswordResetToken', () => {
  const agora = new Date('2026-11-16T12:00:00Z');
  const token = PasswordResetToken.emitir({ id: 't', userId: 'u', tokenHash: 'h', agora });

  it('expira em 30 minutos', () => {
    expect(token.expiresAt.getTime() - agora.getTime()).toBe(VALIDADE_MS);
    expect(token.utilizavel(new Date(agora.getTime() + VALIDADE_MS - 1))).toBe(true);
    expect(token.utilizavel(new Date(agora.getTime() + VALIDADE_MS))).toBe(false);
  });

  it('não pode ser reutilizado', () => {
    const usado = new PasswordResetToken({ ...token, usedAt: agora });
    expect(usado.utilizavel(agora)).toBe(false);
  });

  it('só permite novo e-mail após 2 minutos', () => {
    expect(PasswordResetToken.podeReenviar(null, agora)).toBe(true);
    expect(PasswordResetToken.podeReenviar(new Date(agora.getTime() - 119_000), agora)).toBe(false);
    expect(PasswordResetToken.podeReenviar(new Date(agora.getTime() - 120_000), agora)).toBe(true);
  });
});

describe('ValidationError', () => {
  it('tem mensagem padrão e erros por campo', () => {
    const e = ValidationError.campo('email', 'x');
    expect(e.message).toBe('Os dados informados são inválidos.');
    expect(e.errors).toEqual({ email: ['x'] });
  });
});
