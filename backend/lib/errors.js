// Error format shared by every 4xx response in docs/openapi.yaml:
// { code, message, details?: [{ field, issue }] }

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const badRequest = (message = 'Invalid input syntax or query parameter.', details) =>
  new ApiError(400, 'BAD_REQUEST', message, details);
const unauthorized = (message = 'Authentication token is missing or invalid.') =>
  new ApiError(401, 'UNAUTHORIZED', message);
const forbidden = (message = 'You do not have permission to perform this action on the requested resource.') =>
  new ApiError(403, 'FORBIDDEN', message);
const notFound = (message = 'The requested resource was not found.') =>
  new ApiError(404, 'NOT_FOUND', message);
const conflict = (message = 'Action cannot be completed due to referential integrity or lifecycle constraints.') =>
  new ApiError(409, 'CONFLICT', message);
const validation = (details, message = 'Validation failed.') =>
  new ApiError(422, 'VALIDATION_ERROR', message, details);

// Express error middleware: turns ApiError and common Mongoose/Mongo errors into the shared Error schema.
function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  if (res.headersSent) return next(err);

  if (err instanceof ApiError) {
    const body = { code: err.code, message: err.message };
    if (err.details) body.details = err.details;
    return res.status(err.status).json(body);
  }
  if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
    return res.status(400).json({ code: 'BAD_REQUEST', message: 'Malformed JSON request body.' });
  }
  if (err.name === 'ValidationError' && err.errors) {
    const details = Object.values(err.errors).map((e) => ({ field: e.path, issue: e.message }));
    return res.status(422).json({ code: 'VALIDATION_ERROR', message: 'Validation failed.', details });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ code: 'BAD_REQUEST', message: `Invalid value for ${err.path}.` });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'record';
    return res.status(409).json({ code: 'CONFLICT', message: `A record with this ${field} already exists.` });
  }
  console.error(err);
  return res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
}

module.exports = { ApiError, badRequest, unauthorized, forbidden, notFound, conflict, validation, errorHandler };
