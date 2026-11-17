const express = require('express');
const { Payment, Booking, nextId, ENUMS } = require('../models');
const { notFound, conflict, badRequest, validation } = require('../lib/errors');
const { parseId, optionalId, paginate, round2 } = require('../lib/http');
const { posInt, num, oneOf } = require('../lib/validate');
const { assertPaymentTransition, onPaymentPaid, onPaymentVoided } = require('../lib/lifecycle');
const { wants, enrichPayments } = require('../lib/enrich');

const router = express.Router();

async function findPayment(id) {
  const p = await Payment.findOne({ payment_id: parseId(id, 'payment_id') });
  if (!p) throw notFound('Payment not found.');
  return p;
}

// Applies method/amount/status changes, running the booking cascade when the status moves to Paid or Voided.
async function applyUpdate(payment, { payment_method, amount, payment_status }) {
  if (payment.payment_status === 'Voided') {
    throw conflict(`Payment #${payment.payment_id} is Voided and can no longer be modified.`);
  }
  if (amount !== undefined && round2(amount) !== payment.amount && payment.payment_status !== 'Pending') {
    throw conflict(`The amount of a ${payment.payment_status} payment cannot be changed.`);
  }
  const next = payment_status ?? payment.payment_status;
  assertPaymentTransition(payment, next);

  const booking = await Booking.findOne({ booking_id: payment.booking_id });
  const statusChanged = next !== payment.payment_status;
  if (statusChanged && next === 'Paid' && booking?.booking_status === 'Cancelled') {
    throw conflict(`Booking #${booking.booking_id} is Cancelled and cannot be paid.`);
  }

  if (payment_method !== undefined) payment.payment_method = payment_method;
  if (amount !== undefined) payment.amount = round2(amount);
  payment.payment_status = next;
  await payment.save();

  if (statusChanged && booking) {
    if (next === 'Paid') await onPaymentPaid(booking);
    if (next === 'Voided') await onPaymentVoided(booking);
  }
  return payment;
}

router.get('/', async (req, res) => {
  const filter = {};
  const booking = optionalId(req.query.booking_id, 'booking_id');
  if (booking) filter.booking_id = booking;
  if (req.query.payment_status !== undefined) {
    if (!ENUMS.PAYMENT_STATUSES.includes(req.query.payment_status)) {
      throw badRequest(`payment_status must be one of: ${ENUMS.PAYMENT_STATUSES.join(', ')}.`);
    }
    filter.payment_status = req.query.payment_status;
  }
  // Extension: payments belonging to one customer's bookings
  const customer = optionalId(req.query.customer_id, 'customer_id');
  if (customer) {
    const ids = (await Booking.find({ customer_id: customer }).select('booking_id').lean()).map((b) => b.booking_id);
    filter.booking_id = booking ? (ids.includes(booking) ? booking : -1) : { $in: ids };
  }
  res.json(await paginate(Payment, filter, req.query, { payment_id: -1 }, wants(req.query) ? enrichPayments : undefined));
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const details = [];
  const booking_id = posInt(details, body, 'booking_id');
  const payment_method = oneOf(details, body, 'payment_method', ENUMS.PAYMENT_METHODS);
  const amount = num(details, body, 'amount', { min: 0.01, max: 99999999.99 });
  const payment_status = oneOf(details, body, 'payment_status', ENUMS.PAYMENT_STATUSES);
  if (payment_status === 'Voided') details.push({ field: 'payment_status', issue: 'A new payment cannot be created as Voided.' });
  let booking = null;
  if (booking_id !== undefined) {
    booking = await Booking.findOne({ booking_id });
    if (!booking) details.push({ field: 'booking_id', issue: 'booking_id must reference an existing booking.' });
  }
  if (details.length) throw validation(details);

  if (booking.booking_status === 'Cancelled') throw conflict(`Booking #${booking_id} is Cancelled and cannot be paid.`);
  const existing = await Payment.findOne({ booking_id, is_active: true });
  if (existing) {
    throw conflict(`Booking #${booking_id} already has a ${existing.payment_status} payment (#${existing.payment_id}). Each booking allows only one active payment.`);
  }

  const payment = await Payment.create({
    payment_id: await nextId('payment_id'), booking_id, payment_method, amount: round2(amount), payment_status,
  });
  if (payment_status === 'Paid') await onPaymentPaid(booking);
  res.status(201).json(payment);
});

router.get('/:payment_id', async (req, res) => {
  const payment = await findPayment(req.params.payment_id);
  res.json(wants(req.query) ? (await enrichPayments([payment]))[0] : payment);
});

router.put('/:payment_id', async (req, res) => {
  const payment = await findPayment(req.params.payment_id);
  const body = req.body || {};
  const details = [];
  const booking_id = posInt(details, body, 'booking_id');
  const payment_method = oneOf(details, body, 'payment_method', ENUMS.PAYMENT_METHODS);
  const amount = num(details, body, 'amount', { min: 0.01, max: 99999999.99 });
  const payment_status = oneOf(details, body, 'payment_status', ENUMS.PAYMENT_STATUSES);
  if (booking_id !== undefined && booking_id !== payment.booking_id) {
    details.push({ field: 'booking_id', issue: 'A payment cannot be moved to another booking (1:1 relationship).' });
  }
  if (details.length) throw validation(details);
  res.json(await applyUpdate(payment, { payment_method, amount, payment_status }));
});

router.patch('/:payment_id', async (req, res) => {
  const payment = await findPayment(req.params.payment_id);
  const body = req.body || {};
  if (!Object.keys(body).length) throw badRequest('Provide at least one field to update.');
  const details = [];
  const payment_method = oneOf(details, body, 'payment_method', ENUMS.PAYMENT_METHODS, { required: false });
  const payment_status = oneOf(details, body, 'payment_status', ENUMS.PAYMENT_STATUSES, { required: false });
  if (details.length) throw validation(details);
  res.json(await applyUpdate(payment, { payment_method, payment_status }));
});

// Void: payment_status -> Voided and the linked booking reverts to Pending.
router.patch('/:payment_id/void', async (req, res) => {
  const payment = await findPayment(req.params.payment_id);
  res.json(await applyUpdate(payment, { payment_status: 'Voided' }));
});

// DELETE voids rather than removing the row, so the ledger keeps its audit trail.
router.delete('/:payment_id', async (req, res) => {
  const payment = await findPayment(req.params.payment_id);
  await applyUpdate(payment, { payment_status: 'Voided' });
  res.status(204).end();
});

module.exports = router;
