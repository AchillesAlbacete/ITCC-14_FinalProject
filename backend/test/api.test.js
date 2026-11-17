// Integration tests for the Freight-Flow API business rules.
// Run with: npm test   (spins up its own in-memory MongoDB; the first run downloads the mongod binary)
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server-core');

const { createApp } = require('../server');
const { seedIfEmpty } = require('../seed');
const { syncCounters } = require('../models');

let mongod, server, base;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('freight_flow_test'));
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  await syncCounters();
  await seedIfEmpty({ log: () => {} });
  await new Promise((resolve) => { server = createApp().listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await mongoose.disconnect();
  await mongod.stop();
});

async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const get = (p) => call('GET', p);
const post = (p, b) => call('POST', p, b);
const patch = (p, b) => call('PATCH', p, b);
const put = (p, b) => call('PUT', p, b);
const del = (p) => call('DELETE', p);

test('seed data is present and every path alias works', async () => {
  const a = await get('/api/customers');
  const b = await get('/api/v1/customers');
  const c = await get('/customers');
  assert.equal(a.status, 200);
  assert.equal(a.body.total, 8);
  assert.equal(b.body.total, 8);
  assert.equal(c.body.total, 8);
  assert.deepEqual(Object.keys(a.body).sort(), ['data', 'limit', 'page', 'total']);
  assert.equal((await get('/payments')).body.total, 9);
  assert.equal((await get('/api/parcels/1')).body.tracking_number, 'FF-TRK-983421');
});

test('errors use the shared { code, message } schema', async () => {
  const nf = await get('/api/parcels/99999');
  assert.equal(nf.status, 404);
  assert.equal(nf.body.code, 'NOT_FOUND');
  assert.equal((await get('/api/parcels/abc')).status, 400);
  assert.equal((await get('/api/payments?payment_status=Nope')).status, 400);
  assert.equal((await get('/api/does-not-exist')).status, 404);
});

test('customers: polymorphic validation, uniqueness, and delete restrictions', async () => {
  const bad = await post('/api/customers', { account_type: 'E-Commerce', name: 'X', contact_info: 'x@x.ph', address: 'Somewhere' });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.details.some((d) => d.field === 'store_name'));

  const created = await post('/api/customers', {
    account_type: 'Retail', first_name: 'Lena', last_name: 'Ortega', contact_information: 'lena.ortega@email.com', address: '1 Test St',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Lena Ortega');
  assert.equal(created.body.contact_info, 'lena.ortega@email.com');
  assert.equal(created.body.contact_information, 'lena.ortega@email.com');

  const dup = await post('/api/customers', { account_type: 'Retail', first_name: 'L', last_name: 'O', contact_info: 'LENA.ORTEGA@email.com', address: 'x' });
  assert.equal(dup.status, 409);

  const foreign = await patch(`/api/customers/${created.body.customer_id}`, { store_name: 'Nope' });
  assert.equal(foreign.status, 422);
  const retype = await patch(`/api/customers/${created.body.customer_id}`, { account_type: 'Non-Profit' });
  assert.equal(retype.status, 422);

  const np = await post('/api/customers', {
    account_type: 'Non-Profit', name: 'Test Org', contact_info: 'org@test.ph', address: 'Addr',
    tax_exempt_status: true, charity_registration_number: 'SEC-1', donor_reference_codes: ['D1'],
  });
  assert.equal(np.status, 201);
  assert.deepEqual(np.body.donor_reference_codes, ['D1']);

  assert.equal((await del(`/api/customers/${created.body.customer_id}`)).status, 204);
  const blocked = await del('/api/customers/502'); // has active bookings
  assert.equal(blocked.status, 409);
  assert.match(blocked.body.message, /active booking/);
});

test('auth/login finds a customer by email in contact_info', async () => {
  const ok = await post('/api/auth/login', { email: 'maria.santos@email.com', password: 'secret1' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.customer.customer_id, 502);
  assert.equal((await post('/api/auth/login', { email: 'nobody@nowhere.com', password: 'secret1' })).status, 404);
  assert.equal((await post('/api/auth/login', { email: 'maria.santos@email.com', password: '123' })).status, 422);
});

test('branches & staff: CRUD with 409 when dependents exist', async () => {
  const blocked = await del('/api/branches/12');
  assert.equal(blocked.status, 409);

  const b = await post('/api/branches', { branch_name: 'Test Branch', address: 'Test Rd', contact_info: 'test@ff.com' });
  assert.equal(b.status, 201);
  const s = await post('/api/staff', { branch_id: b.body.branch_id, name: 'Temp Courier', role: 'Courier', permission_level: 'Staff' });
  assert.equal(s.status, 201);
  assert.equal((await del(`/api/branches/${b.body.branch_id}`)).status, 409, 'branch with staff');
  assert.equal((await post('/api/staff', { branch_id: 9999, name: 'X', role: 'Courier', permission_level: 'Staff' })).status, 422);
  assert.equal((await del(`/api/staff/${s.body.staff_id}`)).status, 204);
  assert.equal((await del(`/api/branches/${b.body.branch_id}`)).status, 204);

  assert.equal((await del('/api/staff/5')).status, 409, 'courier with active parcels');
  assert.equal((await del('/api/staff/9')).status, 409, 'CSR with an open complaint');
});

test('booking + payment: 1:1 rule, Paid confirms booking, void reverts it', async () => {
  const bk = await post('/api/bookings', { customer_id: 502, branch_id: 12 });
  assert.equal(bk.status, 201);
  assert.equal(bk.body.booking_status, 'Pending');
  assert.equal((await post('/api/bookings', { customer_id: 502, branch_id: 12, booking_status: 'Confirmed' })).status, 422);

  const id = bk.body.booking_id;
  const parcel = await post('/api/parcels', { booking_id: id, sender_id: 502, receiver_id: 509, weight: 2.5, item_name: 'Test Keyboard' });
  assert.equal(parcel.status, 201);
  assert.match(parcel.body.tracking_number, /^FF-TRK-\d{6}$/);
  assert.equal(parcel.body.current_status, 'Pending');

  // Parcel cannot advance while the booking is unpaid
  const early = await patch(`/api/parcels/${parcel.body.parcel_id}`, { current_status: 'Booked' });
  assert.equal(early.status, 409);

  const pay = await post('/api/payments', { booking_id: id, payment_method: 'GCash', amount: 150.5, payment_status: 'Paid' });
  assert.equal(pay.status, 201);
  assert.equal((await get(`/api/bookings/${id}`)).body.booking_status, 'Confirmed');
  assert.equal((await get(`/api/parcels/${parcel.body.parcel_id}`)).body.current_status, 'Booked');

  const dup = await post('/api/payments', { booking_id: id, payment_method: 'Card', amount: 150.5, payment_status: 'Paid' });
  assert.equal(dup.status, 409);
  assert.equal((await post('/api/payments', { booking_id: id, payment_method: 'Crypto', amount: 1, payment_status: 'Paid' })).status, 422);
  assert.equal((await post('/api/payments', { booking_id: 424242, payment_method: 'Cash', amount: 1, payment_status: 'Paid' })).status, 422);

  const voided = await patch(`/api/payments/${pay.body.payment_id}/void`);
  assert.equal(voided.status, 200);
  assert.equal(voided.body.payment_status, 'Voided');
  assert.equal((await get(`/api/bookings/${id}`)).body.booking_status, 'Pending');
  assert.equal((await get(`/api/parcels/${parcel.body.parcel_id}`)).body.current_status, 'Pending');
  assert.equal((await patch(`/api/payments/${pay.body.payment_id}/void`)).status, 409, 'cannot void twice');
  assert.equal((await patch(`/api/payments/${pay.body.payment_id}`, { payment_status: 'Paid' })).status, 409, 'voided is terminal');

  // A voided booking can be paid again with a fresh payment, still 1 active payment
  const again = await post('/api/payments', { booking_id: id, payment_method: 'Cash', amount: 150.5, payment_status: 'Paid' });
  assert.equal(again.status, 201);
  assert.equal((await get(`/api/bookings/${id}`)).body.booking_status, 'Confirmed');

  // DELETE also voids
  assert.equal((await del(`/api/payments/${again.body.payment_id}`)).status, 204);
  assert.equal((await get(`/api/payments/${again.body.payment_id}`)).body.payment_status, 'Voided');
  assert.equal((await get(`/api/bookings/${id}`)).body.booking_status, 'Pending');
});

test('parcel lifecycle: sequential transitions, Delivered is terminal, delivery team', async () => {
  // Seeded parcel 7 is Booked (booking 1007 Confirmed)
  const skip = await patch('/api/parcels/7', { current_status: 'Delivered' });
  assert.equal(skip.status, 409);
  assert.match(skip.body.message, /Invalid status transition/);
  assert.equal((await patch('/api/parcels/7', { current_status: 'In Transit' })).body.current_status, 'In Transit');
  assert.equal((await patch('/api/parcels/7', { current_status: 'Out for Delivery' })).body.current_status, 'Out for Delivery');
  assert.equal((await patch('/api/parcels/7', { current_status: 'Delivered' })).body.current_status, 'Delivered');
  assert.equal((await patch('/api/parcels/7', { current_status: 'Out for Delivery' })).status, 409, 'no regression');
  assert.equal((await patch('/api/parcels/7', { item_name: 'Edited' })).status, 409, 'Delivered parcels are immutable');
  assert.equal((await put('/api/parcels/2', { booking_id: 1002, sender_id: 509, receiver_id: 502, weight: 1, item_name: 'x' })).status, 409);
  assert.equal((await del('/api/parcels/1')).status, 409, 'In Transit parcels cannot be deleted');
  assert.equal((await patch('/api/parcels/1', { current_status: 'Nope' })).status, 422);

  // Delivery team
  assert.equal((await put('/api/parcels/3/delivery-team', { staff_id: 8 })).status, 422, 'CSR is not a Courier');
  assert.equal((await get('/api/parcels/3/delivery-team')).status, 404);
  const assigned = await put('/api/parcels/3/delivery-team', { staff_id: 6 });
  assert.equal(assigned.status, 200);
  assert.deepEqual(assigned.body, { staff_id: 6, parcel_id: 3 });
  const reassigned = await put('/api/parcels/3/delivery-team', { staff_id: 4 });
  assert.equal(reassigned.body.staff_id, 4);
  assert.equal((await get('/api/parcels?staff_id=4')).body.total, 1);
  assert.equal((await del('/api/parcels/3/delivery-team')).status, 204);

  // Failed delivery can be retried
  assert.equal((await patch('/api/parcels/5', { current_status: 'Failed' })).body.current_status, 'Failed');
  assert.equal((await patch('/api/parcels/5', { current_status: 'In Transit' })).body.current_status, 'In Transit');
});

test('booking cancellation: 409 when a parcel left the branch, otherwise cascades', async () => {
  const blocked = await patch('/api/bookings/1001', { booking_status: 'Cancelled' }); // parcel 1 In Transit
  assert.equal(blocked.status, 409);
  assert.equal((await get('/api/bookings/1001')).body.booking_status, 'Confirmed');

  // 1007 -> parcel delivered in the previous test
  assert.equal((await del('/api/bookings/1007')).status, 409);

  // 1003: Pending booking, Pending parcel, Pending (cash) payment
  const ok = await patch('/api/bookings/1003', { booking_status: 'Cancelled' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.booking_status, 'Cancelled');
  assert.equal((await get('/api/parcels?booking_id=1003')).body.total, 0, 'parcel removed');
  assert.equal((await get('/api/payments?booking_id=1003')).body.data[0].payment_status, 'Voided', 'payment voided');
  assert.equal((await patch('/api/bookings/1003', { branch_id: 12 })).status, 409, 'cancelled is terminal');
  assert.equal((await post('/api/payments', { booking_id: 1003, payment_method: 'Cash', amount: 10, payment_status: 'Paid' })).status, 409);
});

test('complaints: create, CSR assignment, resolution workflow', async () => {
  assert.equal((await post('/api/complaints', { customer_id: 502, parcel_id: 1, description: 'x', category: 'Nope' })).status, 422);
  assert.equal((await post('/api/complaints', { customer_id: 503, parcel_id: 1, description: 'x', category: 'Delivery Issue' })).status, 422, 'not their parcel');

  const c = await post('/api/complaints', { customer_id: 502, parcel_id: 1, description: 'Box crushed', category: 'Damaged Item' });
  assert.equal(c.status, 201);
  assert.equal(c.body.status, 'Pending');
  assert.equal(c.body.staff_id, null);

  const id = c.body.complaint_id;
  assert.equal((await patch(`/api/complaints/${id}`, { staff_id: 5 })).status, 422, 'Courier cannot handle complaints');
  const claimed = await patch(`/api/complaints/${id}`, { staff_id: 8, status: 'Investigating' });
  assert.equal(claimed.body.status, 'Investigating');
  assert.equal((await patch(`/api/complaints/${id}`, { status: 'Resolved' })).status, 422, 'outcome required');
  const done = await patch(`/api/complaints/${id}`, { status: 'Resolved', outcome: 'Refunded.' });
  assert.equal(done.body.outcome, 'Refunded.');
  assert.equal((await get(`/api/complaints?status=Resolved&include=details`)).body.data.find((x) => x.complaint_id === id).tracking_number, 'FF-TRK-983421');
  assert.equal((await del(`/api/complaints/${id}`)).status, 204);
});

test('include=details enrichment and dashboard aggregates', async () => {
  const parcels = (await get('/api/parcels?include=details&limit=100')).body.data;
  const p1 = parcels.find((p) => p.parcel_id === 1);
  assert.equal(p1.sender_name, 'Maria Clara Santos');
  assert.equal(p1.courier.name, 'Joshua Reyes');
  assert.equal(p1.payment.payment_status, 'Paid');
  const pays = (await get('/api/payments?include=details')).body.data;
  assert.ok(pays.every((p) => p.booking_status));
  const dash = await get('/api/dashboard');
  assert.equal(dash.status, 200);
  assert.ok(dash.body.payments.collected > 0);
  assert.equal(typeof dash.body.parcels['In Transit'], 'number');
});
