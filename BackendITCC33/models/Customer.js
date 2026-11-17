const mongoose = require('mongoose');

const baseOptions = { discriminatorKey: 'account_type', collection: 'customers' };

// Base Customer Schema
const customerSchema = new mongoose.Schema({
  customer_id: { type: Number, required: true, unique: true }, //[cite: 20]
  name: { type: String, required: true, maxlength: 255 }, //[cite: 20]
  contact_information: { type: String, required: true, maxlength: 255 } //[cite: 20]
}, baseOptions);

const Customer = mongoose.model('Customer', customerSchema);

// Tier 1: Retail 
const Retail = Customer.discriminator('Retail', new mongoose.Schema({
  first_name: { type: String, required: true, maxlength: 100 }, //[cite: 20]
  last_name: { type: String, required: true, maxlength: 100 }, //[cite: 21]
  residential_address: { type: String, required: true, maxlength: 255 }, //[cite: 21]
  contact_number: { type: String, required: true, maxlength: 20 } //[cite: 21]
}));

// Tier 2: E-Commerce
const ECommerce = Customer.discriminator('E-Commerce', new mongoose.Schema({
  store_name: { type: String, required: true, maxlength: 150 }, //[cite: 21]
  business_registration_number: { type: String, required: true, maxlength: 50 }, //[cite: 21]
  return_address_override: { type: String, required: true, maxlength: 255 } //[cite: 21]
}));

// Tier 3: Non-Profit
const NonProfit = Customer.discriminator('Non-Profit', new mongoose.Schema({
  tax_exempt_status: { type: String, required: true, enum: ['Exempt', 'Non-Exempt'] }, //[cite: 21]
  charity_registration_number: { type: String, required: true, maxlength: 50 }, //[cite: 21]
  donor_reference_codes: { type: String, required: true, maxlength: 100 } //[cite: 22]
}));

module.exports = { Customer, Retail, ECommerce, NonProfit };