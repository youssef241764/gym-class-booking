'use strict';
// Service-to-service communication.
//
// Each backend exposes a small set of /internal/* endpoints that are NOT for
// browsers. They require the header "x-internal-key" whose value is a random
// 256-bit key stored in Secrets Manager under gym/<service>/internal-key.
// A caller's IAM role is only allowed to read the keys of the services it
// actually calls (least privilege), e.g. booking-service can read the
// class-service and attendance-service keys but not the identity key.

const crypto = require('crypto');
const config = require('./config');
const log = require('./logger');
const { getSecret } = require('./secrets');
const { HttpError, forbidden } = require('./errors');

// How a service is reached:
//  - on your PC: HTTP, e.g. CLASS_SERVICE_URL=http://localhost:3002
//  - on Lambda:  a direct Lambda invoke, e.g. CLASS_SERVICE_FUNCTION=gym-class-service.
//    The caller's IAM role may invoke only the functions it needs, and the
//    x-internal-key check below still applies.
const SERVICE_FUNCTION_ENV = {
  'class-service': 'CLASS_SERVICE_FUNCTION',
  'booking-service': 'BOOKING_SERVICE_FUNCTION',
  'attendance-service': 'ATTENDANCE_SERVICE_FUNCTION',
  identity: 'IDENTITY_SERVICE_FUNCTION',
};
const SERVICE_URL_ENV = {
  'class-service': 'CLASS_SERVICE_URL',
  'booking-service': 'BOOKING_SERVICE_URL',
  'attendance-service': 'ATTENDANCE_SERVICE_URL',
  identity: 'IDENTITY_SERVICE_URL',
};

const keySecretId = (service) => `${process.env.SECRET_PREFIX || 'gym'}/${service}/internal-key`;

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// Middleware protecting /internal/* routes of the current service.
function requireInternalKey(req, _res, next) {
  const provided = req.headers['x-internal-key'];
  getSecret(keySecretId(config.serviceName))
    .then((expected) => {
      if (!provided || !safeEqual(provided, expected)) {
        log.security('INTERNAL_ACCESS_DENIED', { requestId: req.id, path: req.path, caller: req.headers['x-caller'] || 'unknown' });
        return next(forbidden('INTERNAL_ONLY', 'Internal endpoint'));
      }
      req.caller = req.headers['x-caller'] || 'unknown';
      next();
    })
    .catch(next);
}

// Call another service's internal endpoint. Throws HttpError(503) if the
// dependency is down so callers can decide to fail-open or fail-closed.
// Sends an API Gateway (payload 2.0) shaped event straight to the other function.
async function invokeFunction(functionName, method, path, headers, body, timeoutMs) {
  const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
  const client = invokeFunction.client || (invokeFunction.client = new LambdaClient({ region: config.region, ...(config.endpoint ? { endpoint: config.endpoint } : {}) }));
  const [rawPath, rawQueryString = ''] = path.split('?');
  const event = {
    version: '2.0', routeKey: '$default', rawPath, rawQueryString, headers,
    requestContext: { http: { method, path: rawPath, sourceIp: '127.0.0.1' }, requestId: headers['x-request-id'] || crypto.randomUUID() },
    body: body ? JSON.stringify(body) : undefined, isBase64Encoded: false,
  };
  const out = await client.send(new InvokeCommand({ FunctionName: functionName, Payload: Buffer.from(JSON.stringify(event)) }), { abortSignal: AbortSignal.timeout(timeoutMs) });
  if (out.FunctionError) throw new Error(`Lambda ${functionName} failed: ${out.FunctionError}`);
  const result = JSON.parse(Buffer.from(out.Payload).toString('utf8') || '{}');
  const text = result.isBase64Encoded ? Buffer.from(result.body || '', 'base64').toString('utf8') : (result.body || '');
  return { status: result.statusCode || 500, ok: (result.statusCode || 500) < 400, text };
}

async function httpCall(base, method, path, headers, body, timeoutMs) {
  const res = await fetch(base.replace(/\/$/, '') + path, {
    method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, ok: res.ok, text: await res.text() };
}

async function callService(service, method, path, body, { timeoutMs = 5000, requestId } = {}) {
  const fn = process.env[SERVICE_FUNCTION_ENV[service]];
  const base = config.resolveUrl(process.env[SERVICE_URL_ENV[service]]);
  if (!fn && !base) throw new HttpError(503, 'DEPENDENCY_NOT_CONFIGURED', `${service} URL not configured`);
  const key = await getSecret(keySecretId(service));
  const headers = {
    'content-type': 'application/json',
    'x-internal-key': key,
    'x-caller': config.serviceName,
    ...(requestId ? { 'x-request-id': requestId } : {}),
  };
  const started = Date.now();
  try {
    const res = fn
      ? await invokeFunction(fn, method, path, headers, body, timeoutMs * 3)
      : await httpCall(base, method, path, headers, body, timeoutMs);
    const text = res.text;
    const data = text ? JSON.parse(text) : null;
    log.info('INTERNAL_CALL', { target: service, method, path, status: res.status, ms: Date.now() - started, requestId });
    if (!res.ok) {
      throw new HttpError(res.status, (data && data.error && data.error.code) || 'DEPENDENCY_ERROR',
        (data && data.error && data.error.message) || `${service} returned ${res.status}`);
    }
    return data;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    log.error('DEPENDENCY_UNAVAILABLE', { target: service, path, reason: err.name, requestId });
    throw new HttpError(503, 'DEPENDENCY_UNAVAILABLE', `${service} is unavailable`);
  }
}

module.exports = { requireInternalKey, callService, keySecretId, safeEqual };
