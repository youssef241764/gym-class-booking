'use strict';

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (code, msg, details) => new HttpError(400, code, msg, details);
const unauthorized = (msg = 'Authentication required') => new HttpError(401, 'UNAUTHENTICATED', msg);
const forbidden = (code = 'FORBIDDEN', msg = 'You are not allowed to perform this action') => new HttpError(403, code, msg);
const notFound = (what = 'Resource') => new HttpError(404, 'NOT_FOUND', `${what} not found`);
const conflict = (code, msg, details) => new HttpError(409, code, msg, details);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict };
