const express = require('express');
const { Complaint, Customer, Parcel, Staff, nextId, ENUMS } = require('../models');
const { notFound, badRequest, validation } = require('../lib/errors');
const { parseId, optionalId, paginate } = require('../lib/http');
const { str, posInt, oneOf } = require('../lib/validate');
const { wants, enrichComplaints } = require('../lib/enrich');

const router = express.Router();

async function findComplaint(id) {
  const c = await Complaint.findOne({ complaint_id: parseId(id, 'complaint_id') });
  if (!c) throw notFound('Complaint not found.');
  return c;
}

router.get('/', async (req, res) => {
  const filter = {};
  for (const [key, allowed] of [['category', ENUMS.COMPLAINT_CATEGORIES], ['status', ENUMS.COMPLAINT_STATUSES]]) {
    if (req.query[key] !== undefined) {
      if (!allowed.includes(req.query[key])) throw badRequest(`${key} must be one of: ${allowed.join(', ')}.`);
      filter[key] = req.query[key];
    }
  }
  for (const key of ['staff_id', 'customer_id', 'parcel_id']) {
    const v = optionalId(req.query[key], key);
    if (v) filter[key] = v;
  }
  res.json(await paginate(Complaint, filter, req.query, { complaint_id: -1 }, wants(req.query) ? enrichComplaints : undefined));
});

router.post('/', async (req, res) => {
  const body = req.body || {};
  const details = [];
  const customer_id = posInt(details, body, 'customer_id');
  const parcel_id = posInt(details, body, 'parcel_id');
  const description = str(details, body, 'description', { max: 2000 });
  const category = oneOf(details, body, 'category', ENUMS.COMPLAINT_CATEGORIES);
  if (customer_id !== undefined && !(await Customer.exists({ customer_id }))) {
    details.push({ field: 'customer_id', issue: 'customer_id must reference an existing customer.' });
  }
  if (parcel_id !== undefined) {
    const parcel = await Parcel.findOne({ parcel_id });
    if (!parcel) details.push({ field: 'parcel_id', issue: 'parcel_id must reference an existing parcel.' });
    else if (customer_id !== undefined && parcel.sender_id !== customer_id && parcel.receiver_id !== customer_id) {
      details.push({ field: 'parcel_id', issue: 'You can only file complaints about parcels you sent or received.' });
    }
  }
  if (details.length) throw validation(details);
  const complaint = await Complaint.create({
    complaint_id: await nextId('complaint_id'), customer_id, parcel_id, description, category,
    status: 'Pending', staff_id: null, outcome: null,
  });
  res.status(201).json(complaint);
});

router.get('/:complaint_id', async (req, res) => {
  const complaint = await findComplaint(req.params.complaint_id);
  res.json(wants(req.query) ? (await enrichComplaints([complaint]))[0] : complaint);
});

// ComplaintResolution: assign a CSR, move through the workflow, record the outcome.
router.patch('/:complaint_id', async (req, res) => {
  const complaint = await findComplaint(req.params.complaint_id);
  const body = req.body || {};
  if (!Object.keys(body).length) throw badRequest('Provide at least one field to update.');
  const details = [];

  let staff_id;
  if (body.staff_id === null) staff_id = null;
  else if (body.staff_id !== undefined) {
    staff_id = posInt(details, body, 'staff_id');
    if (staff_id !== undefined) {
      const staff = await Staff.findOne({ staff_id });
      if (!staff) details.push({ field: 'staff_id', issue: 'staff_id must reference an existing staff member.' });
      else if (staff.role !== 'Customer Service Representative') {
        details.push({ field: 'staff_id', issue: `${staff.name} is a ${staff.role}; only Customer Service Representatives can handle complaints.` });
      }
    }
  }
  const status = oneOf(details, body, 'status', ENUMS.COMPLAINT_STATUSES, { required: false });
  const outcome = str(details, body, 'outcome', { max: 1000, required: false, nullable: true });

  const finalStatus = status ?? complaint.status;
  const finalOutcome = outcome !== undefined ? outcome : complaint.outcome;
  if (['Resolved', 'Dismissed'].includes(finalStatus) && !finalOutcome) {
    details.push({ field: 'outcome', issue: `outcome is required when status is ${finalStatus}.` });
  }
  if (details.length) throw validation(details);

  if (staff_id !== undefined) complaint.staff_id = staff_id;
  if (status !== undefined) complaint.status = status;
  if (outcome !== undefined) complaint.outcome = outcome;
  await complaint.save();
  res.json(complaint);
});

router.delete('/:complaint_id', async (req, res) => {
  const complaint = await findComplaint(req.params.complaint_id);
  await complaint.deleteOne();
  res.status(204).end();
});

module.exports = router;
