'use strict';

const { ValidationError } = require('./errors');

const MAX = 180;
// Validação pragmática: parte local, "@", domínio com ao menos um ponto. Sem espaços.
const FORMATO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Value object de e-mail: normalizado (sem espaços nas pontas, minúsculas) e validado. */
class Email {
  /** @param {string} valor já normalizado */
  constructor(valor) {
    this.valor = valor;
    Object.freeze(this);
  }

  /**
   * @param {unknown} entrada
   * @param {string} [campo] nome do campo nas mensagens de erro
   */
  static of(entrada, campo = 'email') {
    if (typeof entrada !== 'string' || entrada.trim() === '') {
      throw ValidationError.campo(campo, 'Informe o e-mail.');
    }
    const valor = entrada.trim().toLowerCase();
    if (valor.length > MAX || !FORMATO.test(valor)) {
      throw ValidationError.campo(campo, 'Informe um e-mail válido.');
    }
    return new Email(valor);
  }

  /** E-mail com a parte local mascarada (ex.: m***a@example.com), para telas e logs. */
  mascarado() {
    const [local, dominio] = this.valor.split('@');
    const meio = local.length <= 2 ? `${local[0]}***` : `${local[0]}***${local[local.length - 1]}`;
    return `${meio}@${dominio}`;
  }

  toString() {
    return this.valor;
  }
}

module.exports = { Email, EMAIL_MAX: MAX };
