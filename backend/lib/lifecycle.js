// Business rules shared by the bookings, payments and parcels routes (see "Core Business Logic" in docs/openapi.yaml).
const { Booking, Payment, Parcel, DeliveryTeam } = require('../models');
const { conflict } = require('./errors');

// ---------------------------------------------------------------------------
// Parcel status lifecycle: Pending -> Booked -> In Transit -> Out for Delivery -> Delivered (or Failed).
// Delivered is terminal (409 on any change). Failed may be retried by going back In Transit.
// ---------------------------------------------------------------------------
const PARCEL_NEXT = {
  Pending: ['Booked'],
  Booked: ['In Transit'],
  'In Transit': ['Out for Delivery', 'Failed'],
  'Out for Delivery': ['Delivered', 'Failed'],
  Failed: ['In Transit'],
  Delivered: [],
};
// A booking can only be cancelled while no parcel has physically left the branch.
const PARCEL_LEFT_BRANCH = ['In Transit', 'Out for Delivery', 'Delivered'];

function assertParcelTransition(parcel, next, booking) {
  const from = parcel.current_status;
  if (from === next) return;
  if (from === 'Delivered') throw conflict(`Parcel ${parcel.tracking_number} is already Delivered and its status cannot change.`);
  if (!PARCEL_NEXT[from].includes(next)) {
    throw conflict(`Invalid status transition: ${from} → ${next}. Allowed next status: ${PARCEL_NEXT[from].join(', ') || 'none'}.`);
  }
  if (from === 'Pending' && booking && booking.booking_status !== 'Confirmed') {
    throw conflict(`Booking #${booking.booking_id} is ${booking.booking_status}; its payment must be verified (Paid) before the parcel can be Booked.`);
  }
}

// ---------------------------------------------------------------------------
// Payment <-> Booking (1:1)
// ---------------------------------------------------------------------------
const PAYMENT_NEXT = {
  Pending: ['Paid', 'Failed', 'Voided'],
  Paid: ['Voided'],
  Failed: [],
  Voided: [],
};

// Paid payment verified: booking Pending -> Confirmed and its Pending parcels advance to Booked.
async function onPaymentPaid(booking) {
  if (booking.booking_status === 'Cancelled') {
    throw conflict(`Booking #${booking.booking_id} is Cancelled and cannot be paid.`);
  }
  booking.booking_status = 'Confirmed';
  await booking.save();
  await Parcel.updateMany({ booking_id: booking.booking_id, current_status: 'Pending' }, { current_status: 'Booked' });
}

// Payment voided: booking reverts to Pending; parcels not yet collected (Booked) go back to Pending.
async function onPaymentVoided(booking) {
  if (booking && booking.booking_status === 'Confirmed') {
    booking.booking_status = 'Pending';
    await booking.save();
  }
  if (booking) await Parcel.updateMany({ booking_id: booking.booking_id, current_status: 'Booked' }, { current_status: 'Pending' });
}

function assertPaymentTransition(payment, next) {
  if (payment.payment_status === next) return;
  if (!PAYMENT_NEXT[payment.payment_status].includes(next)) {
    const hint = payment.payment_status === 'Paid' && next !== 'Voided' ? ' Void the payment instead.' : '';
    throw conflict(`Invalid payment status change: ${payment.payment_status} → ${next}.${hint}`);
  }
}

// ---------------------------------------------------------------------------
// Booking cancellation cascade
// ---------------------------------------------------------------------------
async function cancelBooking(booking) {
  const parcels = await Parcel.find({ booking_id: booking.booking_id });
  const blocking = parcels.find((p) => PARCEL_LEFT_BRANCH.includes(p.current_status));
  if (blocking) {
    throw conflict(`Booking #${booking.booking_id} cannot be cancelled: parcel ${blocking.tracking_number} is already ${blocking.current_status}.`);
  }
  const ids = parcels.map((p) => p.parcel_id);
  if (ids.length) {
    await DeliveryTeam.deleteMany({ parcel_id: { $in: ids } });
    await Parcel.deleteMany({ parcel_id: { $in: ids } });
  }
  const payment = await Payment.findOne({ booking_id: booking.booking_id, is_active: true });
  if (payment) {
    payment.payment_status = 'Voided';
    await payment.save();
  }
  booking.booking_status = 'Cancelled';
  await booking.save();
}

module.exports = {
  PARCEL_NEXT, PARCEL_LEFT_BRANCH, assertParcelTransition,
  assertPaymentTransition, onPaymentPaid, onPaymentVoided, cancelBooking,
  Booking,
};
