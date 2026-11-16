'use strict';

/**
 * Erros do domínio e da aplicação. Os handlers convertem cada um para a resposta HTTP do contrato
 * (fiapx-docs/api/openapi.yaml); nenhuma camada interna conhece HTTP.
 */

const MENSAGEM_VALIDACAO = 'Os dados informados são inválidos.';

/** Dados de entrada inválidos, com mensagens por campo (→ 422 com `errors`). */
class ValidationError extends Error {
  /** @param {Record<string, string[]>} errors */
  constructor(errors, message = MENSAGEM_VALIDACAO) {
    super(message);
    this.name = 'ValidationError';
    this.errors = errors;
  }

  static campo(campo, mensagem) {
    return new ValidationError({ [campo]: [mensagem] });
  }
}

/** Cadastro recusado sem revelar o motivo (ex.: e-mail já cadastrado) (→ 422 genérico). */
class RegistrationRejectedError extends Error {
  constructor() {
    super('Não foi possível concluir o cadastro.');
    this.name = 'RegistrationRejectedError';
  }
}

/** E-mail ou senha inválidos, sempre com a mesma mensagem (→ 401). */
class InvalidCredentialsError extends Error {
  constructor() {
    super('E-mail ou senha inválidos.');
    this.name = 'InvalidCredentialsError';
  }
}

/** Token de redefinição inexistente, expirado ou já usado: a mesma resposta para os três (→ 422). */
class InvalidResetTokenError extends Error {
  constructor() {
    super('O link de redefinição é inválido ou expirou. Peça um novo.');
    this.name = 'InvalidResetTokenError';
  }
}

/** JWT ausente, inválido ou expirado (o authorizer nega o acesso). */
class InvalidAccessTokenError extends Error {
  constructor(motivo = 'token inválido') {
    super(motivo);
    this.name = 'InvalidAccessTokenError';
  }
}

module.exports = {
  MENSAGEM_VALIDACAO,
  ValidationError,
  RegistrationRejectedError,
  InvalidCredentialsError,
  InvalidResetTokenError,
  InvalidAccessTokenError,
};
