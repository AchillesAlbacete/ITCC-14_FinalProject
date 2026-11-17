// Small field validators that collect { field, issue } details for a single 422 response.

// Validates a string field. Returns the trimmed value (or undefined when absent and optional).
function str(details, body, field, { max, required = true, nullable = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (v === null && nullable) return null;
    if (required) details.push({ field, issue: `${field} is required.` });
    return undefined;
  }
  if (typeof v !== 'string' || !v.trim()) {
    details.push({ field, issue: `${field} must be a non-empty string.` });
    return undefined;
  }
  if (max && v.length > max) {
    details.push({ field, issue: `${field} must be at most ${max} characters.` });
    return undefined;
  }
  return v.trim();
}

// Validates an integer >= 1 (foreign keys such as branch_id).
function posInt(details, body, field, { required = true } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) details.push({ field, issue: `${field} is required.` });
    return undefined;
  }
  if (!Number.isInteger(v) || v < 1) {
    details.push({ field, issue: `${field} must be a positive integer.` });
    return undefined;
  }
  return v;
}

// Validates a number within [min, max] with at most `decimals` decimal places.
function num(details, body, field, { min, max, decimals = 2, required = true } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) details.push({ field, issue: `${field} is required.` });
    return undefined;
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    details.push({ field, issue: `${field} must be a number.` });
    return undefined;
  }
  if (v < min || v > max) {
    details.push({ field, issue: `${field} must be between ${min} and ${max}.` });
    return undefined;
  }
  if (Math.abs(Math.round(v * 10 ** decimals) - v * 10 ** decimals) > 1e-6) {
    details.push({ field, issue: `${field} must have at most ${decimals} decimal places.` });
    return undefined;
  }
  return v;
}

// Validates an enum value.
function oneOf(details, body, field, allowed, { required = true } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) details.push({ field, issue: `${field} is required.` });
    return undefined;
  }
  if (!allowed.includes(v)) {
    details.push({ field, issue: `${field} must be one of: ${allowed.join(', ')}.` });
    return undefined;
  }
  return v;
}

module.exports = { str, posInt, num, oneOf };
