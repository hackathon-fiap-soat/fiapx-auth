'use strict';

/**
 * Portas (interfaces) que os casos de uso usam. As implementações ficam em src/infrastructure e são
 * ligadas em src/infrastructure/container.js. Nos testes unitários, são substituídas por fakes.
 *
 * @typedef {import('../domain/user').User} User
 * @typedef {import('../domain/email').Email} Email
 * @typedef {import('../domain/password-reset-token').PasswordResetToken} PasswordResetToken
 *
 * @typedef {object} UserRepository
 * @property {(email: Email) => Promise<User|null>} findByEmail
 * @property {(id: string) => Promise<User|null>} findById
 * @property {(user: User) => Promise<void>} create  lança RegistrationRejectedError se o e-mail já existe
 * @property {(userId: string, passwordHash: string) => Promise<void>} updatePassword
 *
 * @typedef {object} PasswordResetTokenRepository
 * @property {(userId: string) => Promise<Date|null>} lastIssuedAt
 * @property {(userId: string, agora: Date) => Promise<void>} invalidateActive  marca como usados os tokens ainda válidos
 * @property {(token: PasswordResetToken) => Promise<void>} save
 * @property {(tokenHash: string) => Promise<PasswordResetToken|null>} findByHash
 * @property {(tokenHash: string) => Promise<PasswordResetToken|null>} findByHashForUpdate  com lock da linha (dentro de transação)
 * @property {(id: string, agora: Date) => Promise<void>} markUsed
 *
 * @typedef {object} TransactionManager
 * @property {<T>(fn: (repos: {users: UserRepository, resetTokens: PasswordResetTokenRepository}) => Promise<T>) => Promise<T>} run
 *
 * @typedef {object} PasswordHasher
 * @property {(plain: string) => Promise<string>} hash
 * @property {(plain: string, hash: string) => Promise<boolean>} verify
 *
 * @typedef {object} AccessTokenIssuer
 * @property {(user: {id: string, name: string, email: string}) => Promise<{accessToken: string, expiresIn: number}>} issue
 *
 * @typedef {object} AccessTokenVerifier
 * @property {(token: string) => Promise<{sub: string, email: string, name: string}>} verify  lança InvalidAccessTokenError
 *
 * @typedef {object} SecureTokenGenerator
 * @property {() => {token: string, hash: string}} generate  token aleatório (base64url de 32 bytes) e o SHA-256 dele
 * @property {(token: string) => string} hashOf
 *
 * @typedef {object} NotificationPublisher
 * @property {(envelope: object) => Promise<void>} publish  envia um SendNotification para a fila notification-commands
 *
 * @typedef {object} Clock
 * @property {() => Date} now
 *
 * @typedef {object} IdGenerator
 * @property {() => string} next  UUID v7
 */

module.exports = {};
