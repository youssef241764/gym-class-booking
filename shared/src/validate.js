'use strict';
// Request validation with zod. Unknown fields are rejected (strict schemas are
// defined by each service) and the error response lists which fields failed,
// without echoing the submitted values back.

const log = require('./logger');
const { badRequest } = require('./errors');

function validate(schema, where = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[where] === undefined ? {} : req[where]);
    if (!result.success) {
      const issues = result.error.issues.map((i) => ({ field: i.path.join('.') || where, message: i.message }));
      log.security('VALIDATION_FAILED', { requestId: req.id, path: req.path, fields: issues.map((i) => i.field) });
      return next(badRequest('VALIDATION_FAILED', 'Request validation failed', issues));
    }
    if (where === 'query') req.validQuery = result.data;
    else req[where] = result.data;
    next();
  };
}

module.exports = { validate };
