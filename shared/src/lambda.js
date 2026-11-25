'use strict';
// One Lambda handler per service that dispatches on the event shape:
//  - API Gateway HTTP API (payload v2)      -> Express app via serverless-http
//  - SQS batch (EventBridge rule -> queue)   -> onSqs(type, detail, record)
//  - EventBridge scheduled rule              -> onSchedule(event)

const serverless = require('serverless-http');
const log = require('./logger');
const { handleSqsBatch } = require('./events');

function makeHandler(app, { onSqs, onSchedule } = {}) {
  const http = serverless(app, {
    request(req, event) {
      // Some emulators prefix the stage ("/$default") to rawPath; AWS does not.
      if (req.url && req.url.startsWith('/$default/')) req.url = req.url.slice('/$default'.length);
      req.lambdaEvent = {
        requestId: event.requestContext && event.requestContext.requestId,
        sourceIp: event.requestContext && event.requestContext.http && event.requestContext.http.sourceIp,
      };
    },
  });

  return async (event, context) => {
    if (event && Array.isArray(event.Records) && event.Records[0] && event.Records[0].eventSource === 'aws:sqs') {
      if (!onSqs) return { batchItemFailures: [] };
      const queueArn = event.Records[0].eventSourceARN || '';
      return handleSqsBatch(event, (type, detail, record) => onSqs(type, detail, record, queueArn));
    }
    if (event && (event.source === 'aws.events' || event['detail-type'] === 'Scheduled Event')) {
      if (onSchedule) await onSchedule(event);
      return { ok: true };
    }
    if (event && event.action === 'scheduled-task' && onSchedule) {
      await onSchedule(event);
      return { ok: true };
    }
    const res = await http(event, context);
    await log.flush();
    return res;
  };
}

module.exports = { makeHandler };
