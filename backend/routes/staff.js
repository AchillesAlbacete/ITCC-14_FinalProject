const express = require('express');
const { Staff, Branch, DeliveryTeam, Parcel, Complaint, nextId, ENUMS } = require('../models');
const { notFound, conflict, badRequest, validation } = require('../lib/errors');
const { parseId, optionalId, paginate } = require('../lib/http');
const { str, posInt, oneOf } = require('../lib/validate');

const router = express.Router();

async function staffFields(body, { partial }) {
  const details = [];
  const out = {
    branch_id: posInt(details, body, 'branch_id', { required: !partial }),
    name: str(details, body, 'name', { max: 100, required: !partial }),
    role: oneOf(details, body, 'role', ENUMS.STAFF_ROLES, { required: !partial }),
    permission_level: oneOf(details, body, 'permission_level', ENUMS.PERMISSION_LEVELS, { required: !partial }),
  };
  if (out.branch_id !== undefined && !(await Branch.exists({ branch_id: out.branch_id }))) {
    details.push({ field: 'branch_id', issue: 'branch_id must reference an existing branch.' });
  }
  if (details.length) throw validation(details);
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

async function findStaff(id) {
  const s = await Staff.findOne({ staff_id: parseId(id, 'staff_id') });
  if (!s) throw notFound('Staff member not found.');
  return s;
}

router.get('/', async (req, res) => {
  const filter = {};
  const branch = optionalId(req.query.branch_id, 'branch_id');
  if (branch) filter.branch_id = branch;
  if (req.query.role !== undefined) {
    if (!ENUMS.STAFF_ROLES.includes(req.query.role)) throw badRequest(`role must be one of: ${ENUMS.STAFF_ROLES.join(', ')}.`);
    filter.role = req.query.role;
  }
  res.json(await paginate(Staff, filter, req.query, { staff_id: 1 }));
});

router.post('/', async (req, res) => {
  const fields = await staffFields(req.body || {}, { partial: false });
  res.status(201).json(await Staff.create({ staff_id: await nextId('staff_id'), ...fields }));
});

router.get('/:staff_id', async (req, res) => res.json(await findStaff(req.params.staff_id)));

router.put('/:staff_id', async (req, res) => {
  const staff = await findStaff(req.params.staff_id);
  staff.set(await staffFields(req.body || {}, { partial: false }));
  await staff.save();
  res.json(staff);
});

router.patch('/:staff_id', async (req, res) => {
  const staff = await findStaff(req.params.staff_id);
  if (!Object.keys(req.body || {}).length) throw badRequest('Provide at least one field to update.');
  staff.set(await staffFields(req.body, { partial: true }));
  await staff.save();
  res.json(staff);
});

router.delete('/:staff_id', async (req, res) => {
  const staff = await findStaff(req.params.staff_id);
  const id = staff.staff_id;

  // Active = assigned parcel that has not reached a terminal state
  const assigned = await DeliveryTeam.find({ staff_id: id }).select('parcel_id').lean();
  const activeParcels = assigned.length
    ? await Parcel.countDocuments({ parcel_id: { $in: assigned.map((a) => a.parcel_id) }, current_status: { $nin: ['Delivered', 'Failed'] } })
    : 0;
  const openComplaints = await Complaint.countDocuments({ staff_id: id, status: { $in: ['Pending', 'Investigating'] } });

  if (activeParcels || openComplaints) {
    const parts = [];
    if (activeParcels) parts.push(`${activeParcels} active parcel(s) on their delivery team`);
    if (openComplaints) parts.push(`${openComplaints} open complaint(s)`);
    throw conflict(`Cannot delete ${staff.name}: still assigned to ${parts.join(' and ')}.`);
  }
  await DeliveryTeam.deleteMany({ staff_id: id }); // only historical (terminal) assignments remain
  await staff.deleteOne();
  res.status(204).end();
});

module.exports = router;
