// Opt-in `?include=details` enrichment so the UI can render tables without N+1 requests.
// These are non-breaking extensions on top of the OpenAPI schemas: extra read-only properties are added.
const { Customer, Branch, Staff, Booking, Payment, Parcel, DeliveryTeam } = require('../models');

const wants = (query) => String(query.include || '').split(',').includes('details');

const byKey = (rows, key) => new Map(rows.map((r) => [r[key], r]));
const uniq = (arr) => [...new Set(arr.filter((v) => v !== undefined && v !== null))];

const paymentBrief = (p) => (p ? { payment_id: p.payment_id, payment_method: p.payment_method, amount: p.amount, payment_status: p.payment_status } : null);
const parcelBrief = (p) => (p ? { parcel_id: p.parcel_id, tracking_number: p.tracking_number, item_name: p.item_name, weight: p.weight, current_status: p.current_status } : null);

// Latest payment per booking (a booking can hold several historical Voided/Failed rows but only one active).
async function paymentsByBooking(bookingIds) {
  const rows = await Payment.find({ booking_id: { $in: bookingIds } }).sort({ payment_id: 1 }).lean();
  const map = new Map();
  for (const p of rows) {
    const cur = map.get(p.booking_id);
    if (!cur || p.is_active || !cur.is_active) map.set(p.booking_id, p);
  }
  return map;
}

async function enrichBookings(docs) {
  const rows = docs.map((d) => d.toJSON());
  const ids = rows.map((r) => r.booking_id);
  const [customers, branches, payments, parcels] = await Promise.all([
    Customer.find({ customer_id: { $in: uniq(rows.map((r) => r.customer_id)) } }).lean(),
    Branch.find({ branch_id: { $in: uniq(rows.map((r) => r.branch_id)) } }).lean(),
    paymentsByBooking(ids),
    Parcel.find({ booking_id: { $in: ids } }).sort({ parcel_id: 1 }).lean(),
  ]);
  const cMap = byKey(customers, 'customer_id');
  const bMap = byKey(branches, 'branch_id');
  return rows.map((r) => ({
    ...r,
    customer_name: cMap.get(r.customer_id)?.name ?? null,
    branch_name: bMap.get(r.branch_id)?.branch_name ?? null,
    payment: paymentBrief(payments.get(r.booking_id)),
    parcels: parcels.filter((p) => p.booking_id === r.booking_id).map(parcelBrief),
  }));
}

async function enrichPayments(docs) {
  const rows = docs.map((d) => d.toJSON());
  const bookings = await Booking.find({ booking_id: { $in: uniq(rows.map((r) => r.booking_id)) } }).lean();
  const customers = await Customer.find({ customer_id: { $in: uniq(bookings.map((b) => b.customer_id)) } }).lean();
  const bMap = byKey(bookings, 'booking_id');
  const cMap = byKey(customers, 'customer_id');
  return rows.map((r) => {
    const b = bMap.get(r.booking_id);
    return { ...r, booking_status: b?.booking_status ?? null, customer_id: b?.customer_id ?? null, customer_name: b ? cMap.get(b.customer_id)?.name ?? null : null };
  });
}

async function enrichParcels(docs) {
  const rows = docs.map((d) => d.toJSON());
  const bookingIds = uniq(rows.map((r) => r.booking_id));
  const [bookings, teams, payments] = await Promise.all([
    Booking.find({ booking_id: { $in: bookingIds } }).lean(),
    DeliveryTeam.find({ parcel_id: { $in: rows.map((r) => r.parcel_id) } }).lean(),
    paymentsByBooking(bookingIds),
  ]);
  const [customers, couriers, branches] = await Promise.all([
    Customer.find({ customer_id: { $in: uniq(rows.flatMap((r) => [r.sender_id, r.receiver_id])) } }).lean(),
    Staff.find({ staff_id: { $in: uniq(teams.map((t) => t.staff_id)) } }).lean(),
    Branch.find({ branch_id: { $in: uniq(bookings.map((b) => b.branch_id)) } }).lean(),
  ]);
  const bMap = byKey(bookings, 'booking_id');
  const cMap = byKey(customers, 'customer_id');
  const tMap = byKey(teams, 'parcel_id');
  const sMap = byKey(couriers, 'staff_id');
  const brMap = byKey(branches, 'branch_id');
  return rows.map((r) => {
    const b = bMap.get(r.booking_id);
    const team = tMap.get(r.parcel_id);
    const courier = team ? sMap.get(team.staff_id) : null;
    return {
      ...r,
      sender_name: cMap.get(r.sender_id)?.name ?? null,
      receiver_name: cMap.get(r.receiver_id)?.name ?? null,
      booking_status: b?.booking_status ?? null,
      branch_id: b?.branch_id ?? null,
      branch_name: b ? brMap.get(b.branch_id)?.branch_name ?? null : null,
      courier: courier ? { staff_id: courier.staff_id, name: courier.name } : null,
      payment: paymentBrief(payments.get(r.booking_id)),
    };
  });
}

async function enrichComplaints(docs) {
  const rows = docs.map((d) => d.toJSON());
  const [customers, parcels, staff] = await Promise.all([
    Customer.find({ customer_id: { $in: uniq(rows.map((r) => r.customer_id)) } }).lean(),
    Parcel.find({ parcel_id: { $in: uniq(rows.map((r) => r.parcel_id)) } }).lean(),
    Staff.find({ staff_id: { $in: uniq(rows.map((r) => r.staff_id)) } }).lean(),
  ]);
  const cMap = byKey(customers, 'customer_id');
  const pMap = byKey(parcels, 'parcel_id');
  const sMap = byKey(staff, 'staff_id');
  return rows.map((r) => ({
    ...r,
    customer_name: cMap.get(r.customer_id)?.name ?? null,
    tracking_number: pMap.get(r.parcel_id)?.tracking_number ?? null,
    item_name: pMap.get(r.parcel_id)?.item_name ?? null,
    parcel_status: pMap.get(r.parcel_id)?.current_status ?? null,
    staff_name: r.staff_id ? sMap.get(r.staff_id)?.name ?? null : null,
  }));
}

module.exports = { wants, enrichBookings, enrichPayments, enrichParcels, enrichComplaints };
