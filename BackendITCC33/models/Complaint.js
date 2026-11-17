const mongoose = require('mongoose');

const complaintSchema = new mongoose.Schema({
  complaint_id: { type: Number, required: true, unique: true }, //
  customer_id: { type: Number, ref: 'Customer', required: true }, //
  parcel_id: { type: Number, ref: 'Parcel', required: true }, //
  staff_id: { type: Number, ref: 'Staff', required: true }, //
  description: { type: String, required: true, maxlength: 255 }, //
  category: { 
    type: String, 
    required: true, 
    enum: ['Delivery', 'Seller'] //[cite: 16]
  },
  created_at: { type: Date, default: Date.now, required: true } //
});

module.exports = mongoose.model('Complaint', complaintSchema);