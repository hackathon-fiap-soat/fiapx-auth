'use strict';

const mysql = require('mysql2/promise');
const { User } = require('../domain/user');
const { Email } = require('../domain/email');
const { PasswordResetToken } = require('../domain/password-reset-token');
const { RegistrationRejectedError } = require('../domain/errors');

/** Pool pequeno: cada Lambda atende uma requisição por vez. Datas sempre em UTC. */
function createPool(db) {
  return mysql.createPool({
    ...db,
    connectionLimit: 2,
    timezone: 'Z',
    dateStrings: false,
    charset: 'utf8mb4',
    enableKeepAlive: true,
  });
}

const paraUsuario = (r) => r && new User({
  id: r.id, name: r.name, email: new Email(r.email), passwordHash: r.password_hash, createdAt: r.created_at,
});

const paraToken = (r) => r && new PasswordResetToken({
  id: r.id,
  userId: r.user_id,
  tokenHash: r.token_hash,
  expiresAt: r.expires_at,
  usedAt: r.used_at,
  createdAt: r.created_at,
});

/** @param {import('mysql2/promise').Pool|import('mysql2/promise').PoolConnection} db */
function mysqlUserRepository(db) {
  return {
    async findByEmail(email) {
      const [rows] = await db.execute('SELECT * FROM users WHERE email = ?', [email.valor]);
      return paraUsuario(rows[0]) || null;
    },
    async findById(id) {
      const [rows] = await db.execute('SELECT * FROM users WHERE id = ?', [id]);
      return paraUsuario(rows[0]) || null;
    },
    async create(user) {
      try {
        await db.execute(
          'INSERT INTO users (id, name, email, password_hash) VALUES (?, ?, ?, ?)',
          [user.id, user.name, user.email.valor, user.passwordHash],
        );
      } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') throw new RegistrationRejectedError();
        throw e;
      }
    },
    async updatePassword(userId, passwordHash) {
      await db.execute('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);
    },
  };
}

/** @param {import('mysql2/promise').Pool|import('mysql2/promise').PoolConnection} db */
function mysqlResetTokenRepository(db) {
  return {
    async lastIssuedAt(userId) {
      const [rows] = await db.execute(
        'SELECT MAX(created_at) AS ultimo FROM password_reset_tokens WHERE user_id = ?', [userId]);
      return rows[0].ultimo || null;
    },
    async invalidateActive(userId, agora) {
      await db.execute(
        'UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL AND expires_at > ?',
        [agora, userId, agora]);
    },
    async save(t) {
      await db.execute(
        'INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        [t.id, t.userId, t.tokenHash, t.expiresAt, t.createdAt]);
    },
    async findByHash(tokenHash) {
      const [rows] = await db.execute('SELECT * FROM password_reset_tokens WHERE token_hash = ?', [tokenHash]);
      return paraToken(rows[0]) || null;
    },
    async findByHashForUpdate(tokenHash) {
      const [rows] = await db.execute(
        'SELECT * FROM password_reset_tokens WHERE token_hash = ? FOR UPDATE', [tokenHash]);
      return paraToken(rows[0]) || null;
    },
    async markUsed(id, agora) {
      await db.execute('UPDATE password_reset_tokens SET used_at = ? WHERE id = ?', [agora, id]);
    },
  };
}

/** Executa fn numa transação, com repositórios ligados à mesma conexão. */
function mysqlTransactionManager(pool) {
  return {
    async run(fn) {
      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();
        const resultado = await fn({ users: mysqlUserRepository(conn), resetTokens: mysqlResetTokenRepository(conn) });
        await conn.commit();
        return resultado;
      } catch (e) {
        await conn.rollback();
        throw e;
      } finally {
        conn.release();
      }
    },
  };
}

module.exports = { createPool, mysqlUserRepository, mysqlResetTokenRepository, mysqlTransactionManager };
