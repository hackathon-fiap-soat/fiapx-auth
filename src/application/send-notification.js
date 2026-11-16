'use strict';

/**
 * Monta o comando SendNotification v1 (fiapx-docs/contracts/send-notification.v1.schema.json) para os
 * e-mails de senha. Eles ficam fora da SAGA: saga_id e video_id são nulos (ADR-017).
 *
 * @param {{ids: import('./ports').IdGenerator, clock: import('./ports').Clock}} deps
 * @param {{template: 'PASSWORD_RESET'|'PASSWORD_CHANGED', user: {name: string, email: string},
 *          correlationId: string, actionUrl?: string}} dados
 */
function passwordEmail({ ids, clock }, { template, user, correlationId, actionUrl }) {
  const payload = {
    template,
    recipient_email: user.email,
    recipient_name: user.name,
  };
  if (actionUrl) payload.action_url = actionUrl;
  return {
    message_id: ids.next(),
    type: 'SendNotification',
    version: 1,
    saga_id: null,
    video_id: null,
    correlation_id: correlationId,
    occurred_at: clock.now().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    payload,
  };
}

module.exports = { passwordEmail };
