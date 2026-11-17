const express = require('express');
const { Booking, Customer, Branch, Payment, nextId, ENUMS } = require('../models');
const { notFound, conflict, badRequest, validation } = require('../lib/errors');
const { parseId, optionalId, paginate } = require('../lib/http');
const { posInt, oneOf } = require('../lib/validate');
const { cancelBooking } = require('../lib/lifecycle');
const { wants, enrichBookings } = require('../lib/enrich');

const router = express.Router();

async function findBooking(id) {
  const b = await Booking.findOne({ booking_id: parseId(id, 'booking_id') });
  if (!b) throw notFound('Booking not found.');
  return b;
}

async function validateFks(details, { customer_id, branch_id }) {
  if (customer_id !== undefined && !(await Customer.exists({ customer_id }))) {
    details.push({ field: 'customer_id', issue: 'customer_id must reference an existing customer.' });
  }
  if (branch_id !== undefined && !(await Branch.exists({ branch_id }))) {
    details.push({ field: 'branch_id', issue: 'branch_id must reference an existing branch.' });
  }
}

// Applies a status/branch change to an existing booking, enforcing the lifecycle rules.
async function applyUpdate(booking, { branch_id, booking_status }) {
  if (booking.booking_status === 'Cancelled') {
    throw conflict(`Booking #${booking.booking_id} is Cancelled and can no longer be modified.`);
  }
  if (branch_id !== undefined) booking.branch_id = branch_id;

  if (booking_status !== undefined && booking_status !== booking.booking_status) {
    if (booking_status === 'Cancelled') {
      await cancelBooking(booking); // cascades to parcels + payment, 409 if a parcel already left the branch
      return;
    }
    if (booking_status === 'Confirmed') {
      const paid = await Payment.exists({ booking_id: booking.booking_id, payment_status: 'Paid' });
      if (!paid) throw conflict(`Booking #${booking.booking_id} cannot be Confirmed until its payment is Paid.`);
    } else if (booking_status === 'Pending') {
      throw conflict('A Confirmed booking returns to Pending only by voiding its payment.');
    }
    booking.booking_status = booking_status;
  }
  await booking.save();
}

router.get('/', async (req, res) => {
  const filter = {};
  const customer = optionalId(req.query.customer_id, 'customer_id');
  const branch = optionalId(req.query.branch_id, 'branch_id');
  if (customer) filter.customer_id = customer;
  if (branch) filter.branch_id = branch;
  if (req.query.booking_status !== undefined) {
    if (!ENUMS.BOOKING_STATUSES.includes(req.query.booking_status)) {
      throw badRequest(`booking_status must be one of: ${ENUMS.BOOKING_STATUSES.join(', ')}.`);
    }
    filter.booking_status = req.query.booking_status;
  }
  res.json(await paginate(Booking, filter, req.query, { booking_id: -1 }, wants(req.query) ? enrichBookings : undefined));
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const details = [];
  const customer_id = posInt(details, body, 'customer_id');
  const branch_id = posInt(details, body, 'branch_id');
  const status = oneOf(details, body, 'booking_status', ENUMS.BOOKING_STATUSES, { required: false });
  if (status && status !== 'Pending') {
    details.push({ field: 'booking_status', issue: 'A new booking must start as Pending until its payment is verified.' });
  }
  await validateFks(details, { customer_id, branch_id });
  if (details.length) throw validation(details);
  const booking = await Booking.create({ booking_id: await nextId('booking_id'), customer_id, branch_id, booking_status: 'Pending' });
  res.status(201).json(booking);
});

router.get('/:booking_id', async (req, res) => {
  const booking = await findBooking(req.params.booking_id);
  res.json(wants(req.query) ? (await enrichBookings([booking]))[0] : booking);
});

router.put('/:booking_id', async (req, res) => {
  const booking = await findBooking(req.params.booking_id);
  const body = req.body || {};
  const details = [];
  const customer_id = posInt(details, body, 'customer_id');
  const branch_id = posInt(details, body, 'branch_id');
  const booking_status = oneOf(details, body, 'booking_status', ENUMS.BOOKING_STATUSES, { required: false });
  if (customer_id !== undefined && customer_id !== booking.customer_id) {
    details.push({ field: 'customer_id', issue: 'A booking cannot be reassigned to another customer.' });
  }
  await validateFks(details, { branch_id });
  if (details.length) throw validation(details);
  await applyUpdate(booking, { branch_id, booking_status });
  res.json(booking);
});

router.patch('/:booking_id', async (req, res) => {
  const booking = await findBooking(req.params.booking_id);
  const body = req.body || {};
  if (!Object.keys(body).length) throw badRequest('Provide at least one field to update.');
  const details = [];
  const branch_id = posInt(details, body, 'branch_id', { required: false });
  const booking_status = oneOf(details, body, 'booking_status', ENUMS.BOOKING_STATUSES, { required: false });
  await validateFks(details, { branch_id });
  if (details.length) throw validation(details);
  await applyUpdate(booking, { branch_id, booking_status });
  res.json(booking);
});

// DELETE cancels (soft-deletes) the booking so its voided payment keeps a valid reference for the ledger.
router.delete('/:booking_id', async (req, res) => {
  const booking = await findBooking(req.params.booking_id);
  if (booking.booking_status !== 'Cancelled') await cancelBooking(booking);
  res.status(204).end();
});

module.exports = router;
