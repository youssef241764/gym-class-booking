'use strict';
// Express application factory shared by all services so that every backend
// gets the same security baseline:
//  - helmet security headers
//  - CORS restricted to the configured frontend origins
//  - JSON only (415 for other content types), 20 KB body limit
//  - request id + access log line per request (no bodies, no tokens)
//  - rate limiter: RATE_LIMIT_MAX requests per IP per minute (429)
//  - uniform JSON error format and safe error messages (no stack traces)

const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const log = require('./logger');
const { HttpError } = require('./errors');
const { rateLimit } = require('./rateLimit');

function createApp(mountRoutes) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);

  app.use((req, res, next) => {
    const incoming = req.headers['x-request-id'];
    req.id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : crypto.randomUUID();
    res.setHeader('x-request-id', req.id);
    const started = Date.now();
    res.on('finish', () => {
      log.info('HTTP_REQUEST', {
        requestId: req.id, method: req.method, path: req.path, status: res.statusCode,
        ms: Date.now() - started, userId: req.user && req.user.id, role: req.user && req.user.role,
        caller: req.caller,
      });
      if (res.statusCode === 403) log.security('HTTP_403', { requestId: req.id, path: req.path, userId: req.user && req.user.id });
    });
    next();
  });

  app.use(rateLimit);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    origin(origin, cb) {
      // Non-browser callers (service-to-service, curl tests) send no Origin header.
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      log.security('CORS_REJECTED', { origin });
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }));

  app.use((req, _res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.headers['content-length'] !== '0' && req.headers['content-type']
      && !req.is('application/json')) {
      return next(new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json'));
    }
    next();
  });
  // On Lambda, serverless-http hands the request body over as a Buffer. Parse it
  // here with the same rules as express.json (JSON object/array only, max 20 KB).
  app.use((req, _res, next) => {
    if (!Buffer.isBuffer(req.body)) return next();
    const raw = req.body;
    req.body = undefined;
    req._body = true; // tell express.json the body is already handled
    if (raw.length > 20 * 1024) return next(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body too large'));
    if (!raw.length || !req.is('application/json')) return next();
    try {
      const parsed = JSON.parse(raw.toString('utf8'));
      if (parsed === null || typeof parsed !== 'object') throw new Error('not an object');
      req.body = parsed;
    } catch {
      return next(new HttpError(400, 'MALFORMED_JSON', 'Request body is not valid JSON'));
    }
    next();
  });
  app.use(express.json({ limit: '20kb', strict: true }));

  // Health check (Lab 7): runtime is "lambda" in the cloud and "pc" on your laptop.
  const health = (_req, res) => res.status(200).json({
    status: 'ok',
    service: config.serviceName,
    environment: process.env.NODE_ENV || 'development',
    runtime: process.env.AWS_LAMBDA_FUNCTION_NAME ? 'lambda' : 'pc',
  });
  app.get('/api/health', health);
  app.get('/health', health);

  mountRoutes(app);

  app.use((req, _res, next) => next(new HttpError(404, 'ROUTE_NOT_FOUND', `No route for ${req.method} ${req.path}`)));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let code = err.code || 'INTERNAL_ERROR';
    let message = err.message;
    if (err.type === 'entity.parse.failed') { status = 400; code = 'MALFORMED_JSON'; message = 'Request body is not valid JSON'; }
    if (err.type === 'entity.too.large') { status = 413; code = 'PAYLOAD_TOO_LARGE'; message = 'Request body too large'; }
    if (status >= 500) {
      log.error('UNHANDLED_ERROR', { requestId: req.id, path: req.path, errorName: err.name, errorMessage: err.message });
      if (!(err instanceof HttpError)) message = 'Something went wrong. Please try again.';
    }
    res.status(status).json({ error: { code, message, details: err.details, requestId: req.id } });
  });

  return app;
}

module.exports = { createApp };
