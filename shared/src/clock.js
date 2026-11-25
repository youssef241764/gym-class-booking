'use strict';
// Single source of "now" for all business rules.
// For automated integration tests ONLY, a clock offset can be read from a file
// when ALLOW_TEST_CLOCK=true. This is never enabled in Lambda/Floci deployments
// (the deploy script does not set it and it is ignored inside Lambda).

const fs = require('fs');

function offsetMs() {
  if (process.env.ALLOW_TEST_CLOCK !== 'true' || process.env.AWS_LAMBDA_FUNCTION_NAME) return 0;
  const file = process.env.TEST_CLOCK_FILE;
  if (!file) return 0;
  try {
    return Number(fs.readFileSync(file, 'utf8').trim()) || 0;
  } catch {
    return 0;
  }
}

module.exports = {
  now: () => new Date(Date.now() + offsetMs()),
  nowMs: () => Date.now() + offsetMs(),
};
