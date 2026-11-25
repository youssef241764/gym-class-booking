'use strict';
// Business-rule configuration stored in SSM Parameter Store as JSON, e.g.
// /gym/attendance-service/policy. Values can be tuned by an administrator
// without a code change; defaults are used if the parameter is missing.

const { GetParameterCommand } = require('@aws-sdk/client-ssm');
const aws = require('./aws');
const log = require('./logger');

const cache = new Map();

async function loadPolicy(name, defaults) {
  const hit = cache.get(name);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value = { ...defaults };
  try {
    const res = await aws.ssm().send(new GetParameterCommand({ Name: name }));
    value = { ...defaults, ...JSON.parse(res.Parameter.Value) };
  } catch (err) {
    log.warn('POLICY_DEFAULTS_USED', { name, reason: err.name });
  }
  cache.set(name, { value, expires: Date.now() + 5 * 60 * 1000 });
  return value;
}

module.exports = { loadPolicy };
