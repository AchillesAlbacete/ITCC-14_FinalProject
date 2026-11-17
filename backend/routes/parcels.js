const express = require('express');
const { Parcel, Booking, Customer, Staff, DeliveryTeam, Complaint, nextId, ENUMS } = require('../models');
const { notFound, conflict, badRequest, validation } = require('../lib/errors');
const { parseId, optionalId, paginate, escapeRegex } = require('../lib/http');
const { str, posInt, num, oneOf } = require('../lib/validate');
const { assertParcelTransition, PARCEL_LEFT_BRANCH } = require('../lib/lifecycle');
const { wants, enrichParcels } = require('../lib/enrich');

const router = express.Router();

async function findParcel(id) {
  const p = await Parcel.findOne({ parcel_id: parseId(id, 'parcel_id') });
  if (!p) throw notFound('Parcel not found.');
  return p;
}

// System-generated unique tracking code: FF-TRK-XXXXXX
async function generateTracking() {
  for (let i = 0; i < 20; i += 1) {
    const code = `FF-TRK-${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}`;
    if (!(await Parcel.exists({ tracking_number: code }))) return code;
  }
  throw conflict('Could not generate a unique tracking number. Please retry.');
}

async function assertCustomersExist(details, fields) {
  for (const [field, id] of Object.entries(fields)) {
    if (id !== undefined && !(await Customer.exists({ customer_id: id }))) {
      details.push({ field, issue: `${field} must reference an existing customer.` });
    }
  }
}

router.get('/', async (req, res) => {
  const filter = {};
  const set = (key, val) => { if (val) filter[key] = val; };
  set('booking_id', optionalId(req.query.booking_id, 'booking_id'));
  set('sender_id', optionalId(req.query.sender_id, 'sender_id'));
  set('receiver_id', optionalId(req.query.receiver_id, 'receiver_id'));
  if (req.query.current_status !== undefined) {
    if (!ENUMS.PARCEL_STATUSES.includes(req.query.current_status)) {
      throw badRequest(`current_status must be one of: ${ENUMS.PARCEL_STATUSES.join(', ')}.`);
    }
    filter.current_status = req.query.current_status;
  }
  // Extensions: parcels where a customer is sender OR receiver; parcels assigned to a courier; tracking search
  const customer = optionalId(req.query.customer_id, 'customer_id');
  if (customer) filter.$or = [{ sender_id: customer }, { receiver_id: customer }];
  const courier = optionalId(req.query.staff_id ?? req.query.courier_id, 'staff_id');
  if (courier) {
    const ids = (await DeliveryTeam.find({ staff_id: courier }).select('parcel_id').lean()).map((t) => t.parcel_id);
    filter.parcel_id = { $in: ids };
  }
  if (req.query.search) filter.tracking_number = new RegExp(escapeRegex(req.query.search), 'i');
  res.json(await paginate(Parcel, filter, req.query, { parcel_id: -1 }, wants(req.query) ? enrichParcels : undefined));
});

// Validates ParcelCreate (full) or ParcelUpdate (partial) fields.
async function parcelFields(body, { partial }) {
  const details = [];
  const out = {
    booking_id: partial ? undefined : posInt(details, body, 'booking_id'),
    sender_id: partial ? undefined : posInt(details, body, 'sender_id'),
    receiver_id: partial ? undefined : posInt(details, body, 'receiver_id'),
    weight: num(details, body, 'weight', { min: 0.01, max: 999.99, required: !partial }),
    item_name: str(details, body, 'item_name', { max: 100, required: !partial }),
    current_status: oneOf(details, body, 'current_status', ENUMS.PARCEL_STATUSES, { required: false }),
  };
  if (out.booking_id !== undefined && !(await Booking.exists({ booking_id: out.booking_id }))) {
    details.push({ field: 'booking_id', issue: 'booking_id must reference an existing booking.' });
  }
  await assertCustomersExist(details, { sender_id: out.sender_id, receiver_id: out.receiver_id });
  if (details.length) throw validation(details);
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

router.post('/', async (req, res) => {
  const fields = await parcelFields(req.body || {}, { partial: false });
  const booking = await Booking.findOne({ booking_id: fields.booking_id });
  if (booking.booking_status === 'Cancelled') throw conflict(`Booking #${booking.booking_id} is Cancelled.`);
  // A new parcel enters the lifecycle at Pending, or Booked when its booking is already paid.
  const status = fields.current_status ?? (booking.booking_status === 'Confirmed' ? 'Booked' : 'Pending');
  if (!['Pending', 'Booked'].includes(status)) {
    throw validation([{ field: 'current_status', issue: 'A new parcel must start as Pending or Booked.' }]);
  }
  if (status === 'Booked' && booking.booking_status !== 'Confirmed') {
    throw conflict(`Booking #${booking.booking_id} is ${booking.booking_status}; its payment must be Paid before a parcel can be Booked.`);
  }
  const parcel = await Parcel.create({
    ...fields, parcel_id: await nextId('parcel_id'), tracking_number: await generateTracking(), current_status: status,
  });
  res.status(201).json(parcel);
});

router.get('/:parcel_id', async (req, res) => {
  const parcel = await findParcel(req.params.parcel_id);
  res.json(wants(req.query) ? (await enrichParcels([parcel]))[0] : parcel);
});

async function update(parcel, fields) {
  if (parcel.current_status === 'Delivered') {
    throw conflict(`Parcel ${parcel.tracking_number} is already Delivered and cannot be modified.`);
  }
  if (fields.current_status !== undefined) {
    const booking = await Booking.findOne({ booking_id: parcel.booking_id });
    assertParcelTransition(parcel, fields.current_status, booking);
  }
  parcel.set(fields);
  await parcel.save();
  return parcel;
}

router.put('/:parcel_id', async (req, res) => {
  const parcel = await findParcel(req.params.parcel_id);
  res.json(await update(parcel, await parcelFields(req.body || {}, { partial: false })));
});

router.patch('/:parcel_id', async (req, res) => {
  const parcel = await findParcel(req.params.parcel_id);
  if (!Object.keys(req.body || {}).length) throw badRequest('Provide at least one field to update.');
  res.json(await update(parcel, await parcelFields(req.body, { partial: true })));
});

router.delete('/:parcel_id', async (req, res) => {
  const parcel = await findParcel(req.params.parcel_id);
  if (PARCEL_LEFT_BRANCH.includes(parcel.current_status)) {
    throw conflict(`Parcel ${parcel.tracking_number} is ${parcel.current_status} and cannot be deleted.`);
  }
  const open = await Complaint.countDocuments({ parcel_id: parcel.parcel_id, status: { $in: ['Pending', 'Investigating'] } });
  if (open) throw conflict(`Parcel ${parcel.tracking_number} has ${open} open complaint(s) and cannot be deleted.`);
  await DeliveryTeam.deleteMany({ parcel_id: parcel.parcel_id });
  await parcel.deleteOne();
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Delivery team (Courier <-> Parcel)
// ---------------------------------------------------------------------------
router.get('/:parcel_id/delivery-team', async (req, res) => {
  const parcel = await findParcel(req.params.parcel_id);
  const team = await DeliveryTeam.findOne({ parcel_id: parcel.parcel_id });
  if (!team) throw notFound('No courier is assigned to this parcel.');
  res.json(team);
});

router.put('/:parcel_id/delivery-team', async (req, res) => {
  const parcel = await findParcel(req.params.parcel_id);
  const details = [];
  const staff_id = posInt(details, req.body || {}, 'staff_id');
  if (staff_id !== undefined) {
    const staff = await Staff.findOne({ staff_id });
    if (!staff) details.push({ field: 'staff_id', issue: 'staff_id must reference an existing staff member.' });
    else if (staff.role !== 'Courier') details.push({ field: 'staff_id', issue: `${staff.name} is a ${staff.role}; only Courier staff can join a delivery team.` });
  }
  if (details.length) throw validation(details);
  if (['Delivered', 'Failed'].includes(parcel.current_status)) {
    throw conflict(`Parcel ${parcel.tracking_number} is ${parcel.current_status}; its delivery team can no longer change.`);
  }
  const team = await DeliveryTeam.findOneAndUpdate(
    { parcel_id: parcel.parcel_id }, { staff_id, parcel_id: parcel.parcel_id }, { returnDocument: 'after', upsert: true },
  );
  res.json(team);
});

router.delete('/:parcel_id/delivery-team', async (req, res) => {
  const parcel = await findParcel(req.params.parcel_id);
  const removed = await DeliveryTeam.findOneAndDelete({ parcel_id: parcel.parcel_id });
  if (!removed) throw notFound('No courier is assigned to this parcel.');
  res.status(204).end();
});

module.exports = router;
