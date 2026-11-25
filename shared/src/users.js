'use strict';
// Read-only access to the shared identity table (gym-users). Services use it to
// show display names (e.g. on a class roster) and to find an email address for
// notifications. Only the identity service has write permission on this table.

const { GetCommand, BatchGetCommand } = require('@aws-sdk/lib-dynamodb');
const aws = require('./aws');
const config = require('./config');

const cache = new Map();

async function getProfile(userId) {
  const hit = cache.get(userId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const res = await aws.ddbDoc().send(new GetCommand({ TableName: config.tables.users, Key: { userId } }));
  const value = res.Item ? { id: res.Item.userId, name: res.Item.name, email: res.Item.email, role: res.Item.role, status: res.Item.status } : null;
  cache.set(userId, { value, expires: Date.now() + 60 * 1000 });
  return value;
}

async function getProfiles(ids) {
  const unique = [...new Set(ids)].filter(Boolean);
  const out = {};
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    const res = await aws.ddbDoc().send(new BatchGetCommand({
      RequestItems: { [config.tables.users]: { Keys: chunk.map((userId) => ({ userId })), ProjectionExpression: 'userId, #n, #r', ExpressionAttributeNames: { '#n': 'name', '#r': 'role' } } },
    }));
    for (const it of (res.Responses && res.Responses[config.tables.users]) || []) out[it.userId] = { id: it.userId, name: it.name, role: it.role };
  }
  return out;
}

module.exports = { getProfile, getProfiles };
