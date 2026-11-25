'use strict';
// Structured JSON logger. One line per event so CloudWatch Logs metric filters
// can match on fields such as { $.event = "ACCESS_DENIED" }.
// Sensitive values (passwords, tokens, codes, keys) are redacted before writing.

const config = require('./config');

const SENSITIVE = /pass(word)?|token|secret|authorization|api[-_]?key|cookie|code$/i;

function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 5) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = SENSITIVE.test(k) ? '[REDACTED]' : redact(v, depth + 1);
  }
  return out;
}

// Optional shipping to CloudWatch Logs when running outside Lambda (Lambda
// stdout is captured by the platform automatically).
let buffer = [];
let flushTimer = null;
let streamReady = null;
const streamName = `${config.serviceName}-${new Date().toISOString().slice(0, 10)}-${process.pid}`;

async function ensureStream() {
  if (streamReady) return streamReady;
  streamReady = (async () => {
    const { CreateLogStreamCommand } = require('@aws-sdk/client-cloudwatch-logs');
    const cwl = require('./aws').cloudWatchLogs();
    try {
      await cwl.send(new CreateLogStreamCommand({ logGroupName: config.logGroup, logStreamName: streamName }));
    } catch (e) {
      if (e.name !== 'ResourceAlreadyExistsException') throw e;
    }
  })();
  return streamReady;
}

async function flush() {
  flushTimer = null;
  if (!buffer.length) return;
  const events = buffer.splice(0, 500);
  try {
    await ensureStream();
    const { PutLogEventsCommand } = require('@aws-sdk/client-cloudwatch-logs');
    await require('./aws').cloudWatchLogs().send(new PutLogEventsCommand({
      logGroupName: config.logGroup,
      logStreamName: streamName,
      logEvents: events,
    }));
  } catch (e) {
    streamReady = null;
    process.stderr.write(`log shipping failed: ${e.name}\n`);
  }
}

function write(level, event, fields = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    service: config.serviceName,
    event,
    ...redact(fields),
  };
  const line = JSON.stringify(entry);
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
  if (config.shipLogs && config.logGroup && !config.isLambda) {
    buffer.push({ timestamp: Date.now(), message: line });
    if (!flushTimer) flushTimer = setTimeout(flush, 2000);
  }
}

module.exports = {
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
  // Security-relevant events always use level "warn" and a fixed event name
  // so that monitoring filters/alarms can be defined on them.
  security: (event, fields) => write('warn', event, { security: true, ...fields }),
  flush,
  redact,
};
