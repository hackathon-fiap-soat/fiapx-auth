'use strict';

/** Validade do link de redefinição (ADR-017). */
const VALIDADE_MS = 30 * 60 * 1000;
/** Intervalo mínimo entre dois e-mails de redefinição para o mesmo usuário. */
const INTERVALO_REENVIO_MS = 2 * 60 * 1000;

/**
 * Token de redefinição de senha. O banco guarda só o hash SHA-256 do token; o token em si existe apenas
 * no link enviado por e-mail.
 */
class PasswordResetToken {
  /**
   * @param {{id: string, userId: string, tokenHash: string, expiresAt: Date, usedAt?: Date|null, createdAt: Date}} dados
   */
  constructor({ id, userId, tokenHash, expiresAt, usedAt = null, createdAt }) {
    this.id = id;
    this.userId = userId;
    this.tokenHash = tokenHash;
    this.expiresAt = expiresAt;
    this.usedAt = usedAt;
    this.createdAt = createdAt;
  }

  static emitir({ id, userId, tokenHash, agora }) {
    return new PasswordResetToken({
      id,
      userId,
      tokenHash,
      createdAt: agora,
      expiresAt: new Date(agora.getTime() + VALIDADE_MS),
    });
  }

  /** Pode ser usado: ainda não usado e não expirado. */
  utilizavel(agora) {
    return this.usedAt === null && agora.getTime() < this.expiresAt.getTime();
  }

  /** Um pedido novo só gera e-mail se o último foi emitido há pelo menos 2 minutos. */
  static podeReenviar(ultimoEmitidoEm, agora) {
    return !ultimoEmitidoEm || agora.getTime() - ultimoEmitidoEm.getTime() >= INTERVALO_REENVIO_MS;
  }
}

module.exports = { PasswordResetToken, VALIDADE_MS, INTERVALO_REENVIO_MS };
