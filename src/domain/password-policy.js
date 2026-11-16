'use strict';

const { ValidationError } = require('./errors');

const MIN = 8;
// O bcrypt considera só os primeiros 72 bytes; acima disso, partes da senha seriam ignoradas.
const MAX_BYTES = 72;

/**
 * Política de senha (ADR-017): de 8 a 72 caracteres, com pelo menos uma letra maiúscula, um número e um
 * símbolo. Vale para cadastro, redefinição e troca.
 *
 * @param {unknown} senha
 * @returns {string[]} mensagens de erro (vazio se a senha é válida)
 */
function violacoes(senha) {
  if (typeof senha !== 'string' || senha === '') return ['Informe a senha.'];
  const erros = [];
  if (senha.length < MIN) erros.push(`A senha deve ter pelo menos ${MIN} caracteres.`);
  if (Buffer.byteLength(senha, 'utf8') > MAX_BYTES) erros.push(`A senha deve ter no máximo ${MAX_BYTES} caracteres.`);
  if (!/[A-Z]/.test(senha)) erros.push('A senha deve ter pelo menos uma letra maiúscula.');
  if (!/[0-9]/.test(senha)) erros.push('A senha deve ter pelo menos um número.');
  if (!/[^A-Za-z0-9]/.test(senha)) erros.push('A senha deve ter pelo menos um símbolo.');
  return erros;
}

/** Lança ValidationError no campo indicado se a senha não segue a política. */
function garantir(senha, campo = 'password') {
  const erros = violacoes(senha);
  if (erros.length > 0) throw new ValidationError({ [campo]: erros });
}

module.exports = { PasswordPolicy: { violacoes, garantir, MIN, MAX_BYTES } };
