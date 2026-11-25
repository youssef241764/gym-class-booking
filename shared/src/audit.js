'use strict';
// Shared audit log. Every service writes security- and business-relevant
// actions to the append-only DynamoDB table gym-audit.
// Append-only is enforced by IAM, not just by code: service roles are granted
// dynamodb:PutItem on this table but NOT UpdateItem/DeleteItem. Only the
// reporting role (attendance-service) has Query, for the admin audit viewer.

const crypto = require('crypto');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');
const aws = require('./aws');
const config = require('./config');
const log = require('./logger');
const clock = require('./clock');

const RETENTION_DAYS = 180;

async function audit(req, action, { targetType, targetId, outcome = 'SUCCESS', details } = {}) {
  const now = clock.now();
  const item = {
    day: now.toISOString().slice(0, 10),
    sk: `${now.toISOString()}#${crypto.randomUUID()}`,
    at: now.toISOString(),
    service: config.serviceName,
    action,
    outcome,
    actorId: (req && req.user && req.user.id) || 'system',
    actorRole: (req && req.user && req.user.role) || 'system',
    targetType,
    targetId,
    requestId: req && req.id,
    details: details ? log.redact(details) : undefined,
    expiresAt: Math.floor(now.getTime() / 1000) + RETENTION_DAYS * 86400,
  };
  try {
    await aws.ddbDoc().send(new PutCommand({ TableName: config.tables.audit, Item: item }));
  } catch (err) {
    // Auditing must never break the user action, but a failure is itself logged.
    log.error('AUDIT_WRITE_FAILED', { action, reason: err.name });
  }
}

module.exports = { audit };
