const express = require('express');
const { Customer } = require('../models');
const { validation, notFound } = require('../lib/errors');
const { escapeRegex } = require('../lib/http');

const router = express.Router();

// POST /auth/login — DEMO-GRADE lookup, not real authentication.
// The OpenAPI draft defines no credential field on Customer, so the password is only checked for presence/length
// and the customer is found by email (or phone) appearing in `contact_info`. Do not expose this to the internet.
router.post('/login', async (req, res) => {
  const identifier = String(req.body?.email ?? req.body?.contact_info ?? '').trim();
  const password = req.body?.password;
  const details = [];
  if (!identifier) details.push({ field: 'email', issue: 'email is required.' });
  if (typeof password !== 'string' || password.length < 6) details.push({ field: 'password', issue: 'password must be at least 6 characters.' });
  if (details.length) throw validation(details);

  const customer = await Customer.findOne({ contact_info: new RegExp(escapeRegex(identifier), 'i') });
  if (!customer) throw notFound('No account found for that email. Register first.');
  res.json({ customer });
});

module.exports = router;
