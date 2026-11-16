'use strict';

const { SQSClient, SendMessageCommand } = require('@aws-sdk/client-sqs');

/**
 * Publica o SendNotification direto na fila notification-commands (sem outbox, ADR-017): se falhar, a
 * requisição responde erro e o usuário tenta de novo.
 */
function sqsNotificationPublisher(queueUrl, client = new SQSClient({})) {
  return {
    async publish(envelope) {
      await client.send(new SendMessageCommand({
        QueueUrl: await queueUrl(),
        MessageBody: JSON.stringify(envelope),
        MessageAttributes: {
          type: { DataType: 'String', StringValue: envelope.type },
          correlation_id: { DataType: 'String', StringValue: envelope.correlation_id },
        },
      }));
    },
  };
}

module.exports = { sqsNotificationPublisher };
