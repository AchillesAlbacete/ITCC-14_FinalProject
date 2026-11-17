const express = require('express');
const { Branch, Staff, Booking, nextId } = require('../models');
const { notFound, conflict, badRequest, validation } = require('../lib/errors');
const { parseId, paginate, escapeRegex } = require('../lib/http');
const { str } = require('../lib/validate');

const router = express.Router();

function branchFields(body, { partial }) {
  const details = [];
  const out = {
    branch_name: str(details, body, 'branch_name', { max: 50, required: !partial }),
    address: str(details, body, 'address', { max: 200, required: !partial }),
    contact_info: str(details, body, 'contact_info', { max: 50, required: !partial }),
  };
  if (details.length) throw validation(details);
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

async function findBranch(id) {
  const b = await Branch.findOne({ branch_id: parseId(id, 'branch_id') });
  if (!b) throw notFound('Branch not found.');
  return b;
}

router.get('/', async (req, res) => {
  const filter = req.query.search ? { branch_name: new RegExp(escapeRegex(req.query.search), 'i') } : {};
  res.json(await paginate(Branch, filter, req.query, { branch_id: 1 }));
});

router.post('/', async (req, res) => {
  const fields = branchFields(req.body || {}, { partial: false });
  res.status(201).json(await Branch.create({ branch_id: await nextId('branch_id'), ...fields }));
});

router.get('/:branch_id', async (req, res) => res.json(await findBranch(req.params.branch_id)));

router.put('/:branch_id', async (req, res) => {
  const branch = await findBranch(req.params.branch_id);
  branch.set(branchFields(req.body || {}, { partial: false }));
  await branch.save();
  res.json(branch);
});

router.patch('/:branch_id', async (req, res) => {
  const branch = await findBranch(req.params.branch_id);
  if (!Object.keys(req.body || {}).length) throw badRequest('Provide at least one field to update.');
  branch.set(branchFields(req.body, { partial: true }));
  await branch.save();
  res.json(branch);
});

router.delete('/:branch_id', async (req, res) => {
  const branch = await findBranch(req.params.branch_id);
  const [staff, bookings] = await Promise.all([
    Staff.countDocuments({ branch_id: branch.branch_id }),
    Booking.countDocuments({ branch_id: branch.branch_id, booking_status: { $ne: 'Cancelled' } }),
  ]);
  if (staff || bookings) {
    const parts = [];
    if (staff) parts.push(`${staff} staff member(s)`);
    if (bookings) parts.push(`${bookings} active booking(s)`);
    throw conflict(`Cannot delete branch "${branch.branch_name}": ${parts.join(' and ')} still assigned to it.`);
  }
  await branch.deleteOne();
  res.status(204).end();
});

module.exports = router;
