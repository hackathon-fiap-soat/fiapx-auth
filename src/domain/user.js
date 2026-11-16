'use strict';

const { ValidationError } = require('./errors');

const NOME_MAX = 120;

/** Entidade usuário. A senha nunca fica em texto: só o hash bcrypt. */
class User {
  /**
   * @param {{id: string, name: string, email: import('./email').Email, passwordHash: string, createdAt?: Date}} dados
   */
  constructor({ id, name, email, passwordHash, createdAt }) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.passwordHash = passwordHash;
    this.createdAt = createdAt;
  }

  /** Valida e normaliza o nome informado no cadastro. */
  static nomeValido(entrada) {
    if (typeof entrada !== 'string' || entrada.trim() === '') {
      throw ValidationError.campo('name', 'Informe o nome.');
    }
    const nome = entrada.trim().replace(/\s+/g, ' ');
    if (nome.length > NOME_MAX) throw ValidationError.campo('name', `O nome deve ter no máximo ${NOME_MAX} caracteres.`);
    return nome;
  }

  /** Dados públicos (resposta do cadastro e claims do JWT). */
  publico() {
    return { id: this.id, name: this.name, email: this.email.valor };
  }
}

module.exports = { User };
