'use strict';
// Rate limiter (Lab 8): at most RATE_LIMIT_MAX requests per client IP in a sliding
// 60-second window, then 429 + Retry-After. It counts in memory, so each Lambda
// instance (or each PC process) counts on its own - like the lab's workers.
// The client IP is taken from API Gateway (sourceIp) or the TCP socket, never from
// the X-Forwarded-For header, which a client could fake to dodge the limit.

const log = require('./logger');
const { HttpError } = require('./errors');

const WINDOW_MS = 60 * 1000;
const hits = new Map(); // ip -> array of timestamps

function clientIp(req) {
  return (req.lambdaEvent && req.lambdaEvent.sourceIp) || (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimit(req, res, next) {
  const max = Number(process.env.RATE_LIMIT_MAX || 300);
  const ip = clientIp(req);
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (recent.length >= max) {
    const retry = Math.ceil((WINDOW_MS - (now - recent[0])) / 1000);
    res.setHeader('Retry-After', String(retry));
    log.security('RATE_LIMITED', { requestId: req.id, path: req.path, max });
    hits.set(ip, recent);
    return next(new HttpError(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.'));
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear(); // keep memory bounded
  next();
}

module.exports = { rateLimit, clientIp };
