'use strict';

const { Email } = require('../domain/email');
const { PasswordPolicy } = require('../domain/password-policy');
const { User } = require('../domain/user');
const { PasswordResetToken } = require('../domain/password-reset-token');
const {
  ValidationError,
  InvalidCredentialsError,
  InvalidResetTokenError,
  InvalidAccessTokenError,
} = require('../domain/errors');
const { passwordEmail } = require('./send-notification');

// Hash bcrypt (custo 12) de uma senha aleatória: usado para gastar o mesmo tempo no login de um e-mail
// inexistente, para que o tempo de resposta não revele se o e-mail tem cadastro.
const HASH_FICTICIO = '$2b$12$a1CF7GJpnRg14hO0WJhI5eVkih7LGUQSSVLXoJTwqaY2NMg9VHjGC';

function exigirTexto(valor, campo, mensagem) {
  if (typeof valor !== 'string' || valor === '') throw ValidationError.campo(campo, mensagem);
  return valor;
}

/**
 * Casos de uso do fiapx-auth. Cada um recebe as portas por injeção e não conhece HTTP, AWS nem MySQL.
 *
 * @param {object} deps
 * @param {import('./ports').UserRepository} deps.users
 * @param {import('./ports').PasswordResetTokenRepository} deps.resetTokens
 * @param {import('./ports').TransactionManager} deps.transactions
 * @param {import('./ports').PasswordHasher} deps.hasher
 * @param {import('./ports').AccessTokenIssuer} deps.tokenIssuer
 * @param {import('./ports').AccessTokenVerifier} deps.tokenVerifier
 * @param {import('./ports').SecureTokenGenerator} deps.secureTokens
 * @param {import('./ports').NotificationPublisher} deps.notifications
 * @param {import('./ports').Clock} deps.clock
 * @param {import('./ports').IdGenerator} deps.ids
 * @param {{webUrl: () => Promise<string>}} deps.config
 */
function createUseCases(deps) {
  const { users, resetTokens, transactions, hasher, tokenIssuer, tokenVerifier, secureTokens, notifications, clock, ids, config } = deps;

  /** Cadastro: valida tudo, recusa e-mail repetido com erro genérico e grava o hash bcrypt. */
  async function registerUser({ name, email, password }) {
    const erros = {};
    let nome;
    let mail;
    try { nome = User.nomeValido(name); } catch (e) { Object.assign(erros, e.errors); }
    try { mail = Email.of(email); } catch (e) { Object.assign(erros, e.errors); }
    const senha = PasswordPolicy.violacoes(password);
    if (senha.length > 0) erros.password = senha;
    if (Object.keys(erros).length > 0) throw new ValidationError(erros);

    const user = new User({ id: ids.next(), name: nome, email: mail, passwordHash: await hasher.hash(password) });
    await users.create(user);
    return user.publico();
  }

  /** Login: mesma resposta para e-mail inexistente e senha errada. */
  async function authenticateUser({ email, password }) {
    const mail = Email.of(email);
    exigirTexto(password, 'password', 'Informe a senha.');
    const user = await users.findByEmail(mail);
    const confere = await hasher.verify(password, user ? user.passwordHash : HASH_FICTICIO);
    if (!user || !confere) throw new InvalidCredentialsError();
    return emitirAcesso(user);
  }

  async function emitirAcesso(user) {
    const { accessToken, expiresIn } = await tokenIssuer.issue(user.publico());
    return { access_token: accessToken, token_type: 'Bearer', expires_in: expiresIn };
  }

  /** Authorizer: devolve o contexto que o API Gateway repassa ao video-api. */
  async function authorizeRequest({ authorization }) {
    const match = typeof authorization === 'string' && /^Bearer\s+(\S+)$/i.exec(authorization.trim());
    if (!match) throw new InvalidAccessTokenError('header Authorization ausente ou mal formado');
    const claims = await tokenVerifier.verify(match[1]);
    return { user_id: claims.sub, email: claims.email, name: claims.name };
  }

  /**
   * Pedido de redefinição. Nunca revela se o e-mail existe: o chamador responde 202 em qualquer caso.
   * Envia no máximo um e-mail a cada 2 minutos por usuário.
   * @returns {Promise<'enviado'|'ignorado'>} só para testes e logs
   */
  async function requestPasswordReset({ email, correlationId }) {
    const mail = Email.of(email);
    const user = await users.findByEmail(mail);
    if (!user) return 'ignorado';
    const agora = clock.now();
    if (!PasswordResetToken.podeReenviar(await resetTokens.lastIssuedAt(user.id), agora)) return 'ignorado';

    const { token, hash } = secureTokens.generate();
    await resetTokens.invalidateActive(user.id, agora);
    await resetTokens.save(PasswordResetToken.emitir({ id: ids.next(), userId: user.id, tokenHash: hash, agora }));

    const actionUrl = `${(await config.webUrl()).replace(/\/$/, '')}/redefinir-senha?token=${token}`;
    await notifications.publish(passwordEmail({ ids, clock }, {
      template: 'PASSWORD_RESET', user: user.publico(), correlationId, actionUrl,
    }));
    return 'enviado';
  }

  function validarFormatoToken(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43,64}$/.test(token)) throw new InvalidResetTokenError();
    return token;
  }

  /** Tela "Criar nova senha": confere o link e devolve o e-mail mascarado e a expiração. */
  async function verifyResetToken({ token }) {
    const registro = await resetTokens.findByHash(secureTokens.hashOf(validarFormatoToken(token)));
    if (!registro || !registro.utilizavel(clock.now())) throw new InvalidResetTokenError();
    const user = await users.findById(registro.userId);
    if (!user) throw new InvalidResetTokenError();
    return { email_masked: user.email.mascarado(), expires_at: registro.expiresAt.toISOString().replace(/\.\d{3}Z$/, 'Z') };
  }

  /** Redefinição pelo link: troca a senha e marca o token como usado na mesma transação; já devolve o JWT. */
  async function resetPassword({ token, password, correlationId }) {
    const hashToken = secureTokens.hashOf(validarFormatoToken(token));
    PasswordPolicy.garantir(password, 'password');

    const user = await transactions.run(async (repos) => {
      const agora = clock.now();
      const registro = await repos.resetTokens.findByHashForUpdate(hashToken);
      if (!registro || !registro.utilizavel(agora)) throw new InvalidResetTokenError();
      const dono = await repos.users.findById(registro.userId);
      if (!dono) throw new InvalidResetTokenError();
      if (await hasher.verify(password, dono.passwordHash)) {
        throw ValidationError.campo('password', 'A nova senha deve ser diferente da atual.');
      }
      await repos.users.updatePassword(dono.id, await hasher.hash(password));
      await repos.resetTokens.markUsed(registro.id, agora);
      return dono;
    });

    await avisarTroca(user, correlationId);
    return emitirAcesso(user);
  }

  /** Troca de senha de quem está logado (usuário vem do authorizer). */
  async function changePassword({ userId, currentPassword, newPassword, correlationId }) {
    exigirTexto(currentPassword, 'current_password', 'Informe a senha atual.');
    PasswordPolicy.garantir(newPassword, 'new_password');
    const user = await users.findById(userId);
    if (!user) throw new InvalidAccessTokenError('usuário do token não existe');
    if (!(await hasher.verify(currentPassword, user.passwordHash))) {
      throw ValidationError.campo('current_password', 'A senha atual está incorreta.');
    }
    if (currentPassword === newPassword) {
      throw ValidationError.campo('new_password', 'A nova senha deve ser diferente da atual.');
    }
    await users.updatePassword(user.id, await hasher.hash(newPassword));
    await avisarTroca(user, correlationId);
  }

  async function avisarTroca(user, correlationId) {
    await notifications.publish(passwordEmail({ ids, clock }, {
      template: 'PASSWORD_CHANGED', user: user.publico(), correlationId,
    }));
  }

  return { registerUser, authenticateUser, authorizeRequest, requestPasswordReset, verifyResetToken, resetPassword, changePassword };
}

module.exports = { createUseCases, HASH_FICTICIO };
