const express = require('express');
const { Customer, Branch, Staff, Booking, Payment, Parcel, Complaint, ENUMS } = require('../models');
const { optionalId } = require('../lib/http');

const router = express.Router();

const countBy = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]));
const zeroed = (keys, found) => Object.fromEntries(keys.map((k) => [k, found[k] || 0]));

// GET /dashboard — aggregate KPIs for the manager dashboard (extension; not part of the core OpenAPI resources).
// Optional ?branch_id= scopes bookings/parcels/payments to one branch.
router.get('/', async (req, res) => {
  const branch = optionalId(req.query.branch_id, 'branch_id');
  const bookingFilter = branch ? { branch_id: branch } : {};
  const bookingIds = branch ? (await Booking.find(bookingFilter).select('booking_id').lean()).map((b) => b.booking_id) : null;
  const scoped = bookingIds ? { booking_id: { $in: bookingIds } } : {};

  const [parcels, bookings, payments, complaints, branches, customers, staff, bookingsByBranch] = await Promise.all([
    Parcel.aggregate([{ $match: scoped }, { $group: { _id: '$current_status', count: { $sum: 1 } } }]),
    Booking.aggregate([{ $match: bookingFilter }, { $group: { _id: '$booking_status', count: { $sum: 1 } } }]),
    Payment.aggregate([{ $match: scoped }, { $group: { _id: '$payment_status', count: { $sum: 1 }, total: { $sum: '$amount' } } }]),
    Complaint.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
    Branch.countDocuments(),
    Customer.aggregate([{ $group: { _id: '$account_type', count: { $sum: 1 } } }]),
    Staff.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
    Booking.aggregate([{ $group: { _id: '$branch_id', count: { $sum: 1 } } }]),
  ]);

  const payTotals = Object.fromEntries(payments.map((p) => [p._id, p.total]));
  const branchNames = Object.fromEntries((await Branch.find().lean()).map((b) => [b.branch_id, b.branch_name]));

  res.json({
    parcels: zeroed(ENUMS.PARCEL_STATUSES, countBy(parcels)),
    bookings: zeroed(ENUMS.BOOKING_STATUSES, countBy(bookings)),
    payments: {
      counts: zeroed(ENUMS.PAYMENT_STATUSES, countBy(payments)),
      collected: Math.round((payTotals.Paid || 0) * 100) / 100,
      pending_amount: Math.round((payTotals.Pending || 0) * 100) / 100,
    },
    complaints: zeroed(ENUMS.COMPLAINT_STATUSES, countBy(complaints)),
    customers: zeroed(ENUMS.ACCOUNT_TYPES, countBy(customers)),
    staff: zeroed(ENUMS.STAFF_ROLES, countBy(staff)),
    branches,
    bookings_by_branch: bookingsByBranch.map((b) => ({ branch_id: b._id, branch_name: branchNames[b._id] ?? null, bookings: b.count }))
      .sort((a, b) => b.bookings - a.bookings),
  });
});

module.exports = router;
