'use strict';
// Asynchronous integration between services through Amazon EventBridge.
// Producers publish domain events to the custom bus "gym-events"; EventBridge
// rules route them to the SQS queue of the consuming service. Consumers run as
// an SQS event source on the service Lambda (Floci/AWS) or as a poller when the
// service runs as a plain Node process.

const { PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { ReceiveMessageCommand, DeleteMessageCommand, GetQueueUrlCommand } = require('@aws-sdk/client-sqs');
const aws = require('./aws');
const config = require('./config');
const log = require('./logger');

async function publish(detailType, detail) {
  const res = await aws.eventBridge().send(new PutEventsCommand({
    Entries: [{
      EventBusName: config.eventBus,
      Source: `gym.${config.serviceName}`,
      DetailType: detailType,
      Detail: JSON.stringify(detail),
    }],
  }));
  if (res.FailedEntryCount) {
    log.error('EVENT_PUBLISH_FAILED', { detailType });
    throw new Error('event publish failed');
  }
  log.info('EVENT_PUBLISHED', { detailType, ...pickIds(detail) });
}

function pickIds(d) {
  const out = {};
  for (const k of ['classId', 'bookingId', 'memberId']) if (d && d[k]) out[k] = d[k];
  return out;
}

// Normalise an SQS message body into { type, detail }. Bodies come either from
// an EventBridge rule target (full event envelope) or from a direct SendMessage.
function parseMessage(body) {
  const msg = typeof body === 'string' ? JSON.parse(body) : body;
  if (msg['detail-type']) return { type: msg['detail-type'], detail: msg.detail || {} };
  return { type: msg.type, detail: msg.detail || msg };
}

// Lambda SQS batch handler with partial-batch failure reporting.
async function handleSqsBatch(event, handler) {
  const failures = [];
  for (const record of event.Records || []) {
    try {
      const { type, detail } = parseMessage(record.body);
      await handler(type, detail, record);
    } catch (err) {
      log.error('EVENT_HANDLER_FAILED', { messageId: record.messageId, reason: err.message });
      failures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures: failures };
}

async function queueUrl(name) {
  const res = await aws.sqs().send(new GetQueueUrlCommand({ QueueName: name }));
  return res.QueueUrl;
}

// Long-poll loop used when the service runs outside Lambda.
function startPoller(queueName, handler, { intervalMs = 1000 } = {}) {
  let stopped = false;
  let url = null;
  const loop = async () => {
    while (!stopped) {
      try {
        if (!url) url = await queueUrl(queueName);
        const res = await aws.sqs().send(new ReceiveMessageCommand({
          QueueUrl: url, MaxNumberOfMessages: 10, WaitTimeSeconds: 2,
        }));
        for (const m of res.Messages || []) {
          try {
            const { type, detail } = parseMessage(m.Body);
            await handler(type, detail, m);
            await aws.sqs().send(new DeleteMessageCommand({ QueueUrl: url, ReceiptHandle: m.ReceiptHandle }));
          } catch (err) {
            // Not deleted -> becomes visible again -> after maxReceiveCount goes to the DLQ.
            log.error('EVENT_HANDLER_FAILED', { queue: queueName, reason: err.message });
          }
        }
      } catch (err) {
        log.warn('POLL_FAILED', { queue: queueName, reason: err.name });
        url = null;
        await new Promise((r) => setTimeout(r, 3000));
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  };
  loop();
  log.info('POLLER_STARTED', { queue: queueName });
  return () => { stopped = true; };
}

module.exports = { publish, parseMessage, handleSqsBatch, startPoller, queueUrl };
