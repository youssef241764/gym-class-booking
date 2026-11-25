'use strict';
// Central configuration. Every value comes from environment variables so that
// nothing environment-specific (and nothing secret) lives in source code.

const env = (key, fallback) => {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
};

// AWS_ENDPOINT_URL points the SDK at Floci (http://localhost:4566 on the host,
// injected automatically as http://floci:4566 inside Floci Lambda containers).
const endpoint = env('AWS_ENDPOINT_URL');

// Service URLs may contain the placeholder {AWS_ENDPOINT_URL} so the same
// value works on the host and inside Lambda containers.
function resolveUrl(value) {
  if (!value) return value;
  return value.replace('{AWS_ENDPOINT_URL}', (endpoint || '').replace(/\/$/, ''));
}

module.exports = {
  env,
  resolveUrl,
  serviceName: env('SERVICE_NAME', 'unknown-service'),
  region: env('AWS_REGION', env('AWS_DEFAULT_REGION', 'us-east-1')),
  endpoint,
  isLambda: Boolean(process.env.AWS_LAMBDA_FUNCTION_NAME),
  cognito: {
    userPoolId: env('COGNITO_USER_POOL_ID'),
    clientId: env('COGNITO_CLIENT_ID'),
    jwksUrl: env('COGNITO_JWKS_URL'),
  },
  tables: {
    users: env('USERS_TABLE', 'gym-users'),
    audit: env('AUDIT_TABLE', 'gym-audit'),
  },
  eventBus: env('EVENT_BUS_NAME', 'gym-events'),
  corsOrigins: env('CORS_ORIGINS', 'http://localhost:8080,http://localhost:4566')
    .split(',').map((s) => s.trim()).filter(Boolean),
  logGroup: env('LOG_GROUP_NAME'),
  shipLogs: env('SHIP_LOGS_TO_CLOUDWATCH', 'false') === 'true',
  metricsNamespace: env('METRICS_NAMESPACE', 'GymBooking'),
};
