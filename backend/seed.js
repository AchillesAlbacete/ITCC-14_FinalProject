// Idempotent sample data for Cagayan de Oro. Each collection is seeded only when it is empty,
// so restarting the server never duplicates or overwrites records.
//   node seed.js            -> seed any empty collections
//   node seed.js --reset    -> drop everything first, then reseed
const {
  Counter, Retail, ECommerce, NonProfit, Customer, Branch, Staff, Booking, Payment, Parcel, DeliveryTeam, Complaint, syncCounters,
} = require('./models');

const d = (iso) => new Date(`2026-${iso}:00Z`);
// Shipping fee used by the booking page: ₱100.00 base + ₱20.20 per kg
const fee = (kg) => Math.round((100 + 20.2 * kg) * 100) / 100;

const branches = [
  { branch_id: 12, branch_name: 'Cagayan de Oro Main', address: 'Velez St, Cagayan de Oro City', contact_info: 'cdo.main@freight-flow.com' },
  { branch_id: 14, branch_name: 'Limketkai Hub', address: 'Limketkai Center, Lapasan, Cagayan de Oro City', contact_info: '+63-88-857-2214' },
  { branch_id: 15, branch_name: 'Carmen Branch', address: 'Carmen Public Market Rd, Carmen, Cagayan de Oro City', contact_info: '+63-88-858-3315' },
  { branch_id: 17, branch_name: 'Gusa Warehouse', address: 'Zone 5, Gusa, Cagayan de Oro City', contact_info: 'gusa.warehouse@freight-flow.com' },
];

const staff = [
  { staff_id: 1, branch_id: 12, name: 'Rosalinda Uy', role: 'Manager', permission_level: 'Admin' },
  { staff_id: 2, branch_id: 14, name: 'Dennis Tan', role: 'Manager', permission_level: 'Staff' },
  { staff_id: 3, branch_id: 15, name: 'Grace Lumapas', role: 'Manager', permission_level: 'Staff' },
  { staff_id: 4, branch_id: 12, name: 'Jerome Salvador', role: 'Courier', permission_level: 'Staff' },
  { staff_id: 5, branch_id: 12, name: 'Joshua Reyes', role: 'Courier', permission_level: 'Staff' },
  { staff_id: 6, branch_id: 14, name: 'Mark Villanueva', role: 'Courier', permission_level: 'Staff' },
  { staff_id: 7, branch_id: 15, name: 'Jun Abellanosa', role: 'Courier', permission_level: 'Staff' },
  { staff_id: 8, branch_id: 12, name: 'Liza Macaraeg', role: 'Customer Service Representative', permission_level: 'Staff' },
  { staff_id: 9, branch_id: 14, name: 'Carlo Pacana', role: 'Customer Service Representative', permission_level: 'Staff' },
];

const customers = [
  [Retail, { customer_id: 502, name: 'Maria Clara Santos', first_name: 'Maria Clara', last_name: 'Santos', contact_info: 'maria.santos@email.com · +63-917-555-0101', address: '123 Hayes St, Cagayan de Oro City' }],
  [Retail, { customer_id: 503, name: 'Paolo Mercado', first_name: 'Paolo', last_name: 'Mercado', contact_info: 'paolo.mercado@email.com · +63-917-555-0103', address: '88 Pabayo-Chaves St, Cagayan de Oro City' }],
  [Retail, { customer_id: 509, name: 'Juan Dela Cruz', first_name: 'Juan', last_name: 'Dela Cruz', contact_info: 'juan.delacruz@email.com · +63-917-555-0109', address: '45 Tiano Bros St, Cagayan de Oro City' }],
  [Retail, { customer_id: 511, name: 'Ana Lucia Reyes', first_name: 'Ana Lucia', last_name: 'Reyes', contact_info: 'ana.reyes@email.com · +63-917-555-0111', address: '9 Kauswagan Rd, Cagayan de Oro City' }],
  [ECommerce, { customer_id: 514, name: 'Kagay-an Tech Hub', contact_info: 'orders@kagayantech.ph', address: 'Unit 4B Limketkai Center, Cagayan de Oro City', store_name: 'Kagay-an Tech Official', business_registration_number: 'DTI-2026-884120', return_address_override: 'Warehouse 2, Carmen, Cagayan de Oro City' }],
  [ECommerce, { customer_id: 516, name: 'Misamis Mart Online', contact_info: 'support@misamismart.ph', address: '17 Corrales Ave, Cagayan de Oro City', store_name: 'Misamis Mart', business_registration_number: 'DTI-2025-551907', return_address_override: null }],
  [NonProfit, { customer_id: 520, name: 'Mindanao Relief Foundation', contact_info: 'logistics@mindanaorelief.org', address: '45 Corrales Ave, Cagayan de Oro City', tax_exempt_status: true, charity_registration_number: 'SEC-CN202400912', donor_reference_codes: ['DON-2026-A1', 'DON-2026-B4'] }],
  [NonProfit, { customer_id: 523, name: 'Bukidnon Care Alliance', contact_info: 'hello@bukidnoncare.org', address: '12 Mapawa Rd, Cagayan de Oro City', tax_exempt_status: false, charity_registration_number: 'SEC-CN202300418', donor_reference_codes: [] }],
];

const bookings = [
  { booking_id: 1001, customer_id: 502, branch_id: 12, booking_status: 'Confirmed', booking_date: d('11-03T10:00') },
  { booking_id: 1002, customer_id: 509, branch_id: 12, booking_status: 'Confirmed', booking_date: d('11-04T09:00') },
  { booking_id: 1003, customer_id: 511, branch_id: 14, booking_status: 'Pending', booking_date: d('11-05T14:30') },
  { booking_id: 1004, customer_id: 514, branch_id: 14, booking_status: 'Pending', booking_date: d('11-06T08:50') },
  { booking_id: 1005, customer_id: 502, branch_id: 15, booking_status: 'Confirmed', booking_date: d('11-08T16:10') },
  { booking_id: 1006, customer_id: 516, branch_id: 12, booking_status: 'Pending', booking_date: d('11-09T10:55') },
  { booking_id: 1007, customer_id: 520, branch_id: 12, booking_status: 'Confirmed', booking_date: d('11-11T13:40') },
  { booking_id: 1008, customer_id: 523, branch_id: 15, booking_status: 'Pending', booking_date: d('11-12T10:20') },
  { booking_id: 1009, customer_id: 503, branch_id: 14, booking_status: 'Cancelled', booking_date: d('11-13T09:15') },
  { booking_id: 1010, customer_id: 502, branch_id: 12, booking_status: 'Pending', booking_date: d('11-15T11:05') },
];

const parcels = [
  { parcel_id: 1, booking_id: 1001, sender_id: 502, receiver_id: 509, tracking_number: 'FF-TRK-983421', weight: 2.5, item_name: 'Electronics - Mechanical Keyboard', current_status: 'In Transit' },
  { parcel_id: 2, booking_id: 1002, sender_id: 509, receiver_id: 502, tracking_number: 'FF-TRK-481207', weight: 1.2, item_name: 'Books - Nursing Reviewers (Box)', current_status: 'Delivered' },
  { parcel_id: 3, booking_id: 1003, sender_id: 511, receiver_id: 509, tracking_number: 'FF-TRK-215536', weight: 0.8, item_name: 'Clothing - Barong Tagalog', current_status: 'Pending' },
  { parcel_id: 4, booking_id: 1004, sender_id: 514, receiver_id: 502, tracking_number: 'FF-TRK-730912', weight: 6.4, item_name: 'Appliance - Rice Cooker 1.8L', current_status: 'Pending' },
  { parcel_id: 5, booking_id: 1005, sender_id: 502, receiver_id: 511, tracking_number: 'FF-TRK-664018', weight: 3.1, item_name: 'Food - Bukidnon Coffee Beans 3kg', current_status: 'Out for Delivery' },
  { parcel_id: 6, booking_id: 1006, sender_id: 516, receiver_id: 509, tracking_number: 'FF-TRK-309775', weight: 0.45, item_name: 'Accessories - Phone Case Bundle', current_status: 'Pending' },
  { parcel_id: 7, booking_id: 1007, sender_id: 520, receiver_id: 523, tracking_number: 'FF-TRK-852641', weight: 18, item_name: 'Medical - Relief Supplies Pack', current_status: 'Booked' },
  { parcel_id: 8, booking_id: 1008, sender_id: 523, receiver_id: 520, tracking_number: 'FF-TRK-127830', weight: 12.75, item_name: 'Education - School Kits (25 sets)', current_status: 'Pending' },
  { parcel_id: 9, booking_id: 1010, sender_id: 502, receiver_id: 514, tracking_number: 'FF-TRK-596204', weight: 1.75, item_name: 'Documents - Land Title Envelope', current_status: 'Pending' },
];

const w = Object.fromEntries(parcels.map((p) => [p.booking_id, p.weight]));
// 1:1 payments. Booking status mirrors payment status: Paid -> Confirmed, everything else -> Pending/Cancelled.
const payments = [
  { payment_id: 9001, booking_id: 1001, payment_method: 'GCash', amount: fee(w[1001]), payment_status: 'Paid', transaction_date: d('11-03T10:05') },
  { payment_id: 9002, booking_id: 1002, payment_method: 'Card', amount: fee(w[1002]), payment_status: 'Paid', transaction_date: d('11-04T09:12') },
  { payment_id: 9003, booking_id: 1003, payment_method: 'Cash', amount: fee(w[1003]), payment_status: 'Pending', transaction_date: d('11-05T14:40') },
  { payment_id: 9004, booking_id: 1004, payment_method: 'Bank Transfer', amount: fee(w[1004]), payment_status: 'Failed', transaction_date: d('11-06T08:55') },
  { payment_id: 9005, booking_id: 1005, payment_method: 'GCash', amount: fee(w[1005]), payment_status: 'Paid', transaction_date: d('11-08T16:20') },
  { payment_id: 9006, booking_id: 1006, payment_method: 'Card', amount: fee(w[1006]), payment_status: 'Voided', transaction_date: d('11-09T11:03') },
  { payment_id: 9007, booking_id: 1007, payment_method: 'Cash', amount: fee(w[1007]), payment_status: 'Paid', transaction_date: d('11-11T13:47') },
  { payment_id: 9008, booking_id: 1008, payment_method: 'Bank Transfer', amount: fee(w[1008]), payment_status: 'Pending', transaction_date: d('11-12T10:30') },
  { payment_id: 9009, booking_id: 1009, payment_method: 'Card', amount: 135, payment_status: 'Voided', transaction_date: d('11-13T09:20') },
];

const deliveryTeams = [
  { staff_id: 5, parcel_id: 1 }, { staff_id: 6, parcel_id: 2 }, { staff_id: 7, parcel_id: 5 }, { staff_id: 5, parcel_id: 7 },
];

const complaints = [
  { complaint_id: 501, customer_id: 502, parcel_id: 2, staff_id: 8, description: 'Package arrived with damaged outer box.', category: 'Damaged Item', status: 'Resolved', outcome: 'Replacement shipment approved and shipping fee refunded.', created_at: d('11-05T11:30') },
  { complaint_id: 502, customer_id: 502, parcel_id: 1, staff_id: null, description: 'Parcel has been stuck at the Limketkai sorting hub for 3 days.', category: 'Delivery Issue', status: 'Pending', outcome: null, created_at: d('11-14T09:45') },
  { complaint_id: 503, customer_id: 511, parcel_id: 5, staff_id: 9, description: 'Tracker says out for delivery but nobody has come to the door.', category: 'Delivery Issue', status: 'Investigating', outcome: null, created_at: d('11-16T15:10') },
  { complaint_id: 504, customer_id: 502, parcel_id: 4, staff_id: null, description: 'The seller shipped a different rice cooker model than the one advertised.', category: 'Seller Dispute', status: 'Pending', outcome: null, created_at: d('11-16T17:25') },
  { complaint_id: 505, customer_id: 509, parcel_id: 1, staff_id: 8, description: 'Duplicate report — parcel arrived on schedule.', category: 'Delivery Issue', status: 'Dismissed', outcome: 'Duplicate of an earlier ticket; parcel confirmed on schedule.', created_at: d('11-10T08:05') },
];

async function seedIfEmpty({ log = console.log } = {}) {
  const jobs = [
    ['branches', Branch, async () => Branch.insertMany(branches)],
    ['staff', Staff, async () => Staff.insertMany(staff)],
    ['customers', Customer, async () => { for (const [Model, doc] of customers) await Model.create(doc); }],
    ['bookings', Booking, async () => Booking.insertMany(bookings)],
    ['parcels', Parcel, async () => Parcel.insertMany(parcels)],
    ['payments', Payment, async () => Payment.insertMany(payments)],
    ['delivery teams', DeliveryTeam, async () => DeliveryTeam.insertMany(deliveryTeams)],
    ['complaints', Complaint, async () => Complaint.insertMany(complaints)],
  ];
  const seeded = [];
  for (const [label, Model, run] of jobs) {
    if ((await Model.estimatedDocumentCount()) === 0) {
      await run();
      seeded.push(label);
    }
  }
  await syncCounters();
  if (seeded.length) log(`🌱 Seeded sample data: ${seeded.join(', ')}`);
  return seeded;
}

async function resetAll() {
  await Promise.all([Customer, Branch, Staff, Booking, Payment, Parcel, DeliveryTeam, Complaint, Counter].map((M) => M.deleteMany({})));
}

module.exports = { seedIfEmpty, resetAll };

if (require.main === module) {
  require('dotenv').config();
  const mongoose = require('mongoose');
  (async () => {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/freight_flow');
    if (process.argv.includes('--reset')) { await resetAll(); console.log('🗑️  Cleared all collections'); }
    const seeded = await seedIfEmpty();
    if (!seeded.length) console.log('Nothing to seed — all collections already contain data. Use --reset to start over.');
    await mongoose.disconnect();
  })().catch((e) => { console.error(e); process.exit(1); });
}
