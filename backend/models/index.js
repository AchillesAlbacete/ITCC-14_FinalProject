const mongoose = require('mongoose');
const { Schema } = mongoose;

// ---------------------------------------------------------------------------
// Enums (mirror docs/openapi.yaml)
// ---------------------------------------------------------------------------
const ACCOUNT_TYPES = ['Retail', 'E-Commerce', 'Non-Profit'];
const STAFF_ROLES = ['Manager', 'Courier', 'Customer Service Representative'];
const PERMISSION_LEVELS = ['Admin', 'Staff'];
const BOOKING_STATUSES = ['Pending', 'Confirmed', 'Cancelled'];
const PAYMENT_METHODS = ['Cash', 'Card', 'GCash', 'Bank Transfer'];
const PAYMENT_STATUSES = ['Pending', 'Paid', 'Failed', 'Voided'];
const PARCEL_STATUSES = ['Pending', 'Booked', 'In Transit', 'Out for Delivery', 'Delivered', 'Failed'];
const COMPLAINT_CATEGORIES = ['Delivery Issue', 'Seller Dispute', 'Billing Issue', 'Damaged Item'];
const COMPLAINT_STATUSES = ['Pending', 'Investigating', 'Resolved', 'Dismissed'];

// ---------------------------------------------------------------------------
// Auto-increment numeric IDs (customer_id, booking_id, ...) — the spec uses integer keys.
// ---------------------------------------------------------------------------
const Counter = mongoose.model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }, { versionKey: false }));

async function nextId(name) {
  const c = await Counter.findOneAndUpdate({ _id: name }, { $inc: { seq: 1 } }, { returnDocument: 'after', upsert: true });
  return c.seq;
}

// Shared JSON shape: drop Mongo internals, keep numeric ids and ISO timestamps.
function cleanJson(doc, ret) {
  delete ret._id;
  delete ret.__v;
  delete ret.is_active;
  return ret;
}
const baseOptions = {
  versionKey: false,
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  toJSON: { transform: cleanJson },
};

// ---------------------------------------------------------------------------
// Customers (disjoint specialization via discriminator on account_type)
// ---------------------------------------------------------------------------
const customerSchema = new Schema({
  customer_id: { type: Number, required: true, unique: true, index: true },
  name: { type: String, required: true, maxlength: 100, trim: true },
  contact_info: { type: String, required: true, maxlength: 150, trim: true },
  address: { type: String, required: true, maxlength: 200, trim: true },
}, { ...baseOptions, discriminatorKey: 'account_type', collection: 'customers',
  toJSON: { transform(doc, ret) { cleanJson(doc, ret); ret.contact_information = ret.contact_info; return ret; } } });

const Customer = mongoose.model('Customer', customerSchema);

const Retail = Customer.discriminator('Retail', new Schema({
  first_name: { type: String, required: true, maxlength: 50, trim: true },
  last_name: { type: String, required: true, maxlength: 50, trim: true },
}, { versionKey: false }));

const ECommerce = Customer.discriminator('E-Commerce', new Schema({
  store_name: { type: String, required: true, maxlength: 100, trim: true },
  business_registration_number: { type: String, required: true, maxlength: 50, trim: true },
  return_address_override: { type: String, maxlength: 200, default: null },
}, { versionKey: false }));

const NonProfit = Customer.discriminator('Non-Profit', new Schema({
  tax_exempt_status: { type: Boolean, required: true },
  charity_registration_number: { type: String, required: true, maxlength: 50, trim: true },
  donor_reference_codes: { type: [{ type: String, maxlength: 50 }], default: [] },
}, { versionKey: false }));

// ---------------------------------------------------------------------------
// Branches & Staff
// ---------------------------------------------------------------------------
const Branch = mongoose.model('Branch', new Schema({
  branch_id: { type: Number, required: true, unique: true },
  branch_name: { type: String, required: true, maxlength: 50, trim: true },
  address: { type: String, required: true, maxlength: 200, trim: true },
  contact_info: { type: String, required: true, maxlength: 50, trim: true },
}, { ...baseOptions, timestamps: false }));

const Staff = mongoose.model('Staff', new Schema({
  staff_id: { type: Number, required: true, unique: true },
  branch_id: { type: Number, required: true, index: true },
  name: { type: String, required: true, maxlength: 100, trim: true },
  role: { type: String, required: true, enum: STAFF_ROLES },
  permission_level: { type: String, required: true, enum: PERMISSION_LEVELS },
}, { ...baseOptions, timestamps: false }));

// ---------------------------------------------------------------------------
// Bookings, Payments (1:1), Parcels, DeliveryTeam
// ---------------------------------------------------------------------------
const Booking = mongoose.model('Booking', new Schema({
  booking_id: { type: Number, required: true, unique: true },
  customer_id: { type: Number, required: true, index: true },
  branch_id: { type: Number, required: true, index: true },
  booking_date: { type: Date, default: Date.now },
  booking_status: { type: String, enum: BOOKING_STATUSES, default: 'Pending' },
}, { ...baseOptions, timestamps: false }));

const paymentSchema = new Schema({
  payment_id: { type: Number, required: true, unique: true },
  booking_id: { type: Number, required: true },
  payment_method: { type: String, required: true, enum: PAYMENT_METHODS },
  amount: { type: Number, required: true, min: 0.01, max: 99999999.99 },
  payment_status: { type: String, required: true, enum: PAYMENT_STATUSES },
  transaction_date: { type: Date, default: Date.now },
  // Internal flag: true while the payment occupies the booking's single payment slot (Paid/Pending).
  // The partial unique index below enforces "1 booking : 1 active payment" at the database level,
  // while still letting a booking be paid again after a Voided/Failed payment.
  is_active: { type: Boolean, default: true },
}, { ...baseOptions, timestamps: false });
paymentSchema.pre('validate', function setActive() {
  this.is_active = this.payment_status === 'Paid' || this.payment_status === 'Pending';
});
paymentSchema.index({ booking_id: 1 }, { name: 'one_active_payment_per_booking', unique: true, partialFilterExpression: { is_active: true } });
const Payment = mongoose.model('Payment', paymentSchema);

const Parcel = mongoose.model('Parcel', new Schema({
  parcel_id: { type: Number, required: true, unique: true },
  booking_id: { type: Number, required: true, index: true },
  sender_id: { type: Number, required: true, index: true },
  receiver_id: { type: Number, required: true, index: true },
  tracking_number: { type: String, required: true, unique: true, maxlength: 50 },
  weight: { type: Number, required: true, min: 0.01, max: 999.99 },
  item_name: { type: String, required: true, maxlength: 100, trim: true },
  current_status: { type: String, enum: PARCEL_STATUSES, default: 'Pending' },
}, { ...baseOptions, timestamps: false }));

const DeliveryTeam = mongoose.model('DeliveryTeam', new Schema({
  staff_id: { type: Number, required: true, index: true },
  parcel_id: { type: Number, required: true, unique: true }, // one courier per parcel
}, { ...baseOptions, timestamps: false }));

// ---------------------------------------------------------------------------
// Complaints
// ---------------------------------------------------------------------------
const Complaint = mongoose.model('Complaint', new Schema({
  complaint_id: { type: Number, required: true, unique: true },
  customer_id: { type: Number, required: true, index: true },
  parcel_id: { type: Number, required: true, index: true },
  staff_id: { type: Number, default: null },
  description: { type: String, required: true, maxlength: 2000, trim: true },
  category: { type: String, required: true, enum: COMPLAINT_CATEGORIES },
  status: { type: String, enum: COMPLAINT_STATUSES, default: 'Pending' },
  outcome: { type: String, maxlength: 1000, default: null },
  created_at: { type: Date, default: Date.now },
}, { ...baseOptions, timestamps: false }));

// Collections whose numeric PK is tracked by a Counter document.
const ID_FIELDS = [
  [Customer, 'customer_id'], [Branch, 'branch_id'], [Staff, 'staff_id'], [Booking, 'booking_id'],
  [Payment, 'payment_id'], [Parcel, 'parcel_id'], [Complaint, 'complaint_id'],
];

// Keeps each counter >= the highest existing id (safe after manual imports or partial seeds).
async function syncCounters() {
  for (const [Model, field] of ID_FIELDS) {
    const top = await Model.findOne().sort({ [field]: -1 }).select(field).lean();
    const max = top ? top[field] : 0;
    await Counter.updateOne({ _id: field }, { $max: { seq: max } }, { upsert: true });
  }
}

module.exports = {
  Counter, nextId, syncCounters,
  Customer, Retail, ECommerce, NonProfit, Branch, Staff, Booking, Payment, Parcel, DeliveryTeam, Complaint,
  ENUMS: {
    ACCOUNT_TYPES, STAFF_ROLES, PERMISSION_LEVELS, BOOKING_STATUSES, PAYMENT_METHODS,
    PAYMENT_STATUSES, PARCEL_STATUSES, COMPLAINT_CATEGORIES, COMPLAINT_STATUSES,
  },
};
