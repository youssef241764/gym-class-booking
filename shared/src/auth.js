'use strict';
// Authentication + authorization middleware shared by every service.
//
// Identity provider: Amazon Cognito user pool (emulated by Floci).
// Each request must carry "Authorization: Bearer <Cognito access token>".
// The token signature is verified locally against the user pool's JWKS
// (RS256), so a forged or tampered token is rejected without trusting the
// client. Roles come from the signed "cognito:groups" claim, never from the
// request body or a header the browser controls.

const { createLocalJWKSet, jwtVerify } = require('jose');
const config = require('./config');
const log = require('./logger');
const { unauthorized, forbidden } = require('./errors');

const ROLES = ['member', 'trainer', 'admin'];
let jwks = null;

function jwksUrl() {
  if (config.cognito.jwksUrl) return config.resolveUrl(config.cognito.jwksUrl);
  if (!config.cognito.userPoolId) throw new Error('COGNITO_USER_POOL_ID is not configured');
  const base = config.endpoint
    ? config.endpoint.replace(/\/$/, '')
    : `https://cognito-idp.${config.region}.amazonaws.com`;
  return `${base}/${config.cognito.userPoolId}/.well-known/jwks.json`;
}

// Fetch the user pool's public signing keys (JWKS) and cache them for 10 minutes.
async function fetchJwks() {
  const url = jwksUrl();
  let res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok && config.endpoint) {
    // Some emulators (e.g. moto) route requests by the SigV4 credential scope.
    // Retry with a scope-only header; it carries no credential or secret.
    res = await fetch(url, {
      headers: { authorization: `AWS4-HMAC-SHA256 Credential=emulator/20200101/${config.region}/cognito-idp/aws4_request, SignedHeaders=host, Signature=0` },
      signal: AbortSignal.timeout(3000),
    });
  }
  if (!res.ok) throw new Error(`JWKS endpoint returned ${res.status}`);
  return createLocalJWKSet(await res.json());
}

let jwksFetchedAt = 0;
async function getJwks(force = false) {
  if (!jwks || force || Date.now() - jwksFetchedAt > 10 * 60 * 1000) {
    jwks = await fetchJwks();
    jwksFetchedAt = Date.now();
  }
  return jwks;
}

function roleFromGroups(groups) {
  const g = Array.isArray(groups) ? groups : typeof groups === 'string' ? [groups] : [];
  if (g.includes('admin')) return 'admin';
  if (g.includes('trainer')) return 'trainer';
  return 'member';
}

async function verifyAccessToken(token) {
  let result;
  try {
    result = await jwtVerify(token, await getJwks(), { algorithms: ['RS256'], clockTolerance: 30 });
  } catch (err) {
    if (err.code !== 'ERR_JWKS_NO_MATCHING_KEY') throw err;
    // Keys may have rotated: refresh once and retry.
    result = await jwtVerify(token, await getJwks(true), { algorithms: ['RS256'], clockTolerance: 30 });
  }
  const { payload } = result;
  // The issuer must be OUR user pool (issuer host differs between Floci and AWS,
  // so the pool-id suffix is what we pin).
  if (!String(payload.iss || '').endsWith(`/${config.cognito.userPoolId}`)) throw new Error('issuer mismatch');
  if (payload.token_use && payload.token_use !== 'access') throw new Error('not an access token');
  if (payload.client_id && config.cognito.clientId && payload.client_id !== config.cognito.clientId) {
    throw new Error('client mismatch');
  }
  if (!payload.sub) throw new Error('missing subject');
  return {
    id: payload.sub,
    username: payload.username || payload['cognito:username'],
    role: roleFromGroups(payload['cognito:groups']),
  };
}

// Express middleware: rejects with 401 if the token is missing/invalid.
function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const match = /^Bearer ([A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=]+\.[A-Za-z0-9\-_=+/]+)$/.exec(header);
  if (!match) {
    log.security('AUTH_MISSING', { requestId: req.id, method: req.method, path: req.path });
    return next(unauthorized());
  }
  verifyAccessToken(match[1])
    .then((user) => {
      req.user = user;
      next();
    })
    .catch((err) => {
      log.security('AUTH_FAILED', { requestId: req.id, method: req.method, path: req.path, reason: err.code || err.message });
      next(unauthorized('Invalid or expired token'));
    });
}

// Like authenticate, but anonymous requests continue with req.user = null.
// A token that IS present must still be valid.
function authenticateOptional(req, res, next) {
  if (!req.headers.authorization) {
    req.user = null;
    return next();
  }
  return authenticate(req, res, next);
}

// Express middleware factory: 403 unless the authenticated user has one of the roles.
function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      log.security('ACCESS_DENIED', {
        requestId: req.id, userId: req.user.id, role: req.user.role,
        method: req.method, path: req.path, required: roles,
      });
      return next(forbidden('ROLE_NOT_ALLOWED', `This action requires role: ${roles.join(' or ')}`));
    }
    next();
  };
}

// Helper for ownership checks inside handlers (object-level authorization).
function denyNotOwner(req, reason = 'NOT_OWNER') {
  log.security('ACCESS_DENIED', {
    requestId: req.id, userId: req.user && req.user.id, role: req.user && req.user.role,
    method: req.method, path: req.path, reason,
  });
  return forbidden(reason, 'You can only access your own records');
}

module.exports = { ROLES, authenticate, authenticateOptional, requireRole, denyNotOwner, verifyAccessToken, roleFromGroups };
