'use strict';
// Secrets Manager access with a short in-memory cache (5 min) so a rotated
// secret is picked up without redeploying, and we do not call Secrets Manager
// on every request.

const { GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const aws = require('./aws');

const cache = new Map();
const TTL_MS = 5 * 60 * 1000;

async function getSecret(secretId) {
  const hit = cache.get(secretId);
  if (hit && hit.expires > Date.now()) return hit.value;
  const res = await aws.secrets().send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = res.SecretString;
  cache.set(secretId, { value, expires: Date.now() + TTL_MS });
  return value;
}

function clearSecretCache() {
  cache.clear();
}

module.exports = { getSecret, clearSecretCache };
