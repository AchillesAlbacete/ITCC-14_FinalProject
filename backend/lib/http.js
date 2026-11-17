const { badRequest, validation } = require('./errors');

// Parses a positive-integer path/query value (400 when malformed, as in the spec's BadRequest response).
function parseId(value, name = 'id') {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw badRequest(`${name} must be a positive integer.`);
  }
  return Number(value);
}

// Optional positive-integer query filter.
function optionalId(value, name) {
  return value === undefined || value === '' ? undefined : parseId(value, name);
}

// Shared pagination: ?page (1-indexed, default 1) & ?limit (1..100, default 20).
function paging(query) {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 20 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) throw badRequest('page must be an integer >= 1.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badRequest('limit must be an integer between 1 and 100.');
  return { page, limit, skip: (page - 1) * limit };
}

// Runs a paginated find and returns the { data, page, limit, total } envelope.
async function paginate(Model, filter, query, sort, mapFn = (docs) => docs) {
  const { page, limit, skip } = paging(query);
  const [docs, total] = await Promise.all([
    Model.find(filter).sort(sort).skip(skip).limit(limit),
    Model.countDocuments(filter),
  ]);
  return { data: await mapFn(docs), page, limit, total };
}

// Validates that `value` is one of `allowed`; returns an error detail or null.
function enumDetail(field, value, allowed) {
  return allowed.includes(value) ? null : { field, issue: `${field} must be one of: ${allowed.join(', ')}.` };
}

// Throws a 422 when any detail is present.
function assertValid(details) {
  const real = details.filter(Boolean);
  if (real.length) throw validation(real);
}

// Money helper: rounds to 2 decimals (decimal(10,2)).
const round2 = (n) => Math.round(n * 100) / 100;

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

module.exports = { parseId, optionalId, paging, paginate, enumDetail, assertValid, round2, escapeRegex };
