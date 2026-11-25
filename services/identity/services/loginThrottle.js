'use strict';
// Login throttle (DynamoDB table gym-login-throttle).
// After 5 wrong passwords for one email in 15 minutes, sign-in is paused for that
// email until the window ends. The email is stored only as a SHA-256 hash.

const crypto = require('crypto');
const { clock, sdk } = require('gym-shared');

const ddb = require('gym-shared').aws.ddbDoc;
const { GetCommand, PutCommand, DeleteCommand } = sdk.ddb;

const TABLE = process.env.LOGIN_THROTTLE_TABLE || 'gym-login-throttle';
const MAX_FAILURES = 5;
const WINDOW_SEC = 15 * 60;

const emailKey = (e) => crypto.createHash('sha256').update(e).digest('hex');

async function state(e) {
  const res = await ddb().send(new GetCommand({ TableName: TABLE, Key: { key: emailKey(e) } }));
  const it = res.Item;
  if (!it || it.windowStart + WINDOW_SEC < Math.floor(clock.nowMs() / 1000)) return { failures: 0 };
  return it;
}

async function recordFailure(e) {
  const now = Math.floor(clock.nowMs() / 1000);
  const current = await state(e);
  const failures = (current.failures || 0) + 1;
  await ddb().send(new PutCommand({
    TableName: TABLE,
    Item: { key: emailKey(e), failures, windowStart: current.windowStart || now, expiresAt: now + WINDOW_SEC },
  }));
  return failures;
}

async function reset(e) {
  await ddb().send(new DeleteCommand({ TableName: TABLE, Key: { key: emailKey(e) } }));
}

module.exports = { MAX_FAILURES, WINDOW_SEC, emailKey, state, recordFailure, reset };
