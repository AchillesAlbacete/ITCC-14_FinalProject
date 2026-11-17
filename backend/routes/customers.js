const express = require('express');
const { Customer, Retail, ECommerce, NonProfit, Booking, Parcel, Complaint, nextId, ENUMS } = require('../models');
const { notFound, conflict, badRequest, validation } = require('../lib/errors');
const { parseId, paginate, escapeRegex } = require('../lib/http');

const router = express.Router();

const TYPE_MODELS = { Retail, 'E-Commerce': ECommerce, 'Non-Profit': NonProfit };
const SUBTYPE_FIELDS = {
  Retail: ['first_name', 'last_name'],
  'E-Commerce': ['store_name', 'business_registration_number', 'return_address_override'],
  'Non-Profit': ['tax_exempt_status', 'charity_registration_number', 'donor_reference_codes'],
};
const SUBTYPE_REQUIRED = {
  Retail: ['first_name', 'last_name'],
  'E-Commerce': ['store_name', 'business_registration_number'],
  'Non-Profit': ['tax_exempt_status', 'charity_registration_number'],
};
const MAX = { name: 100, contact_info: 150, address: 200, first_name: 50, last_name: 50, store_name: 100,
  business_registration_number: 50, return_address_override: 200, charity_registration_number: 50 };
const ALL_SUBTYPE_FIELDS = [...new Set(Object.values(SUBTYPE_FIELDS).flat())];

// Accepts the spec's `contact_info` and the legacy `contact_information` spelling used by the profile page.
function normalizeBody(body) {
  const b = { ...body };
  if (b.contact_info === undefined && b.contact_information !== undefined) b.contact_info = b.contact_information;
  delete b.contact_information;
  return b;
}

// Validates a full (create/replace) or partial (patch) payload for `type`; returns the clean field set.
function validateCustomer(body, type, { partial }) {
  const details = [];
  const out = {};

  const text = (field, { required }) => {
    const v = body[field];
    if (v === undefined || v === null || v === '') {
      if (required && !partial) details.push({ field, issue: `${field} is required${SUBTYPE_REQUIRED[type]?.includes(field) ? ` for ${type} accounts` : ''}.` });
      if (v === null && field === 'return_address_override') out[field] = null;
      return;
    }
    if (typeof v !== 'string' || !v.trim()) return details.push({ field, issue: `${field} must be a non-empty string.` });
    if (v.length > MAX[field]) return details.push({ field, issue: `${field} must be at most ${MAX[field]} characters.` });
    out[field] = v.trim();
  };

  // Common fields. Retail `name` may be derived from first_name + last_name.
  const derivable = type === 'Retail' && body.first_name && body.last_name;
  text('name', { required: !derivable });
  text('contact_info', { required: true });
  text('address', { required: true });

  // Subtype fields: required ones must be present on create, foreign-type fields are rejected.
  for (const f of ALL_SUBTYPE_FIELDS) {
    if (body[f] === undefined) continue;
    if (!SUBTYPE_FIELDS[type].includes(f)) {
      details.push({ field: f, issue: `${f} is not valid for ${type} accounts.` });
    }
  }
  for (const f of SUBTYPE_FIELDS[type]) {
    if (f === 'tax_exempt_status') {
      if (body[f] === undefined || body[f] === null) {
        if (!partial) details.push({ field: f, issue: `${f} is required for ${type} accounts.` });
      } else if (typeof body[f] !== 'boolean') details.push({ field: f, issue: `${f} must be a boolean.` });
      else out[f] = body[f];
    } else if (f === 'donor_reference_codes') {
      if (body[f] === undefined) continue;
      const ok = Array.isArray(body[f]) && body[f].every((c) => typeof c === 'string' && c.length > 0 && c.length <= 50);
      if (!ok) details.push({ field: f, issue: 'donor_reference_codes must be an array of strings (max 50 characters each).' });
      else out[f] = body[f].map((c) => c.trim());
    } else {
      text(f, { required: SUBTYPE_REQUIRED[type].includes(f) });
    }
  }

  if (details.length) throw validation(details);
  if (type === 'Retail' && !out.name && out.first_name && out.last_name) out.name = `${out.first_name} ${out.last_name}`.slice(0, 100);
  return out;
}

async function assertContactFree(contact, exceptId) {
  const dup = await Customer.findOne({
    contact_info: new RegExp(`^${escapeRegex(contact)}$`, 'i'),
    ...(exceptId ? { customer_id: { $ne: exceptId } } : {}),
  });
  if (dup) throw conflict('A customer with this contact info already exists.');
}

async function findCustomer(id) {
  const c = await Customer.findOne({ customer_id: parseId(id, 'customer_id') });
  if (!c) throw notFound('Customer not found.');
  return c;
}

router.get('/', async (req, res) => {
  const filter = {};
  if (req.query.account_type !== undefined) {
    if (!ENUMS.ACCOUNT_TYPES.includes(req.query.account_type)) throw badRequest(`account_type must be one of: ${ENUMS.ACCOUNT_TYPES.join(', ')}.`);
    filter.account_type = req.query.account_type;
  }
  if (req.query.search) filter.name = new RegExp(escapeRegex(req.query.search), 'i');
  res.json(await paginate(Customer, filter, req.query, { customer_id: 1 }));
});

router.post('/', async (req, res) => {
  const body = normalizeBody(req.body || {});
  if (!ENUMS.ACCOUNT_TYPES.includes(body.account_type)) {
    throw validation([{ field: 'account_type', issue: `account_type must be one of: ${ENUMS.ACCOUNT_TYPES.join(', ')}.` }]);
  }
  const fields = validateCustomer(body, body.account_type, { partial: false });
  await assertContactFree(fields.contact_info);
  const customer = await TYPE_MODELS[body.account_type].create({ customer_id: await nextId('customer_id'), ...fields });
  res.status(201).json(customer);
});

router.get('/:customer_id', async (req, res) => {
  res.json(await findCustomer(req.params.customer_id));
});

router.put('/:customer_id', async (req, res) => {
  const customer = await findCustomer(req.params.customer_id);
  const body = normalizeBody(req.body || {});
  if (body.account_type !== customer.account_type) {
    throw validation([{ field: 'account_type', issue: `account_type cannot be changed (current: ${customer.account_type}).` }]);
  }
  const fields = validateCustomer(body, customer.account_type, { partial: false });
  await assertContactFree(fields.contact_info, customer.customer_id);
  // Full replacement: clear optional subtype fields that were omitted
  if (customer.account_type === 'E-Commerce' && fields.return_address_override === undefined) fields.return_address_override = null;
  if (customer.account_type === 'Non-Profit' && fields.donor_reference_codes === undefined) fields.donor_reference_codes = [];
  customer.set(fields);
  await customer.save();
  res.json(customer);
});

router.patch('/:customer_id', async (req, res) => {
  const customer = await findCustomer(req.params.customer_id);
  const body = normalizeBody(req.body || {});
  if (body.account_type !== undefined && body.account_type !== customer.account_type) {
    throw validation([{ field: 'account_type', issue: `account_type cannot be changed (current: ${customer.account_type}).` }]);
  }
  delete body.account_type;
  if (!Object.keys(body).length) throw badRequest('Provide at least one field to update.');
  const fields = validateCustomer(body, customer.account_type, { partial: true });
  if (fields.contact_info) await assertContactFree(fields.contact_info, customer.customer_id);
  // Keep a Retail account's display name in sync when only first/last name change
  if (customer.account_type === 'Retail' && !body.name && (fields.first_name || fields.last_name)) {
    fields.name = `${fields.first_name ?? customer.first_name} ${fields.last_name ?? customer.last_name}`.slice(0, 100);
  }
  customer.set(fields);
  await customer.save();
  res.json(customer);
});

router.delete('/:customer_id', async (req, res) => {
  const customer = await findCustomer(req.params.customer_id);
  const id = customer.customer_id;
  const [bookings, parcels, complaints] = await Promise.all([
    Booking.countDocuments({ customer_id: id, booking_status: { $in: ['Pending', 'Confirmed'] } }),
    Parcel.countDocuments({ $or: [{ sender_id: id }, { receiver_id: id }], current_status: { $ne: 'Delivered' } }),
    Complaint.countDocuments({ customer_id: id, status: { $in: ['Pending', 'Investigating'] } }),
  ]);
  if (bookings || parcels || complaints) {
    const parts = [];
    if (bookings) parts.push(`${bookings} active booking(s)`);
    if (parcels) parts.push(`${parcels} undelivered parcel(s)`);
    if (complaints) parts.push(`${complaints} unresolved complaint(s)`);
    throw conflict(`Cannot delete customer: ${parts.join(', ')} still linked to this account.`);
  }
  await customer.deleteOne();
  res.status(204).end();
});

module.exports = router;
