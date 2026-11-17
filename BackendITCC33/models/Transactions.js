const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema({
  booking_id: { type: Number, required: true, unique: true }, //[cite: 23]
  customer_id: { type: Number, ref: 'Customer', required: true }, //[cite: 23]
  branch_id: { type: Number, ref: 'Branch', required: true }, //[cite: 23]
  booking_date: { type: Date, default: Date.now, required: true }, //[cite: 23]
  booking_status: { 
    type: String, 
    required: true, 
    enum: ['Pending', 'In-Transit', 'Delivered', 'Cancelled'] //[cite: 23]
  }
});

const parcelSchema = new mongoose.Schema({
  parcel_id: { type: Number, required: true, unique: true }, //[cite: 23]
  booking_id: { type: Number, ref: 'Booking', required: true }, //[cite: 23]
  sender_id: { type: Number, ref: 'Customer', required: true }, //[cite: 19]
  receiver_id: { type: Number, ref: 'Customer', required: true }, //[cite: 19]
  tracking_number: { type: String, required: true, unique: true, maxlength: 50 }, //[cite: 20, 23]
  weight: { type: Number, required: true, min: 0.01 }, //[cite: 20, 24]
  item_name: { type: String, required: true, maxlength: 100 }, //[cite: 24]
  current_status: { 
    type: String, 
    required: true, 
    enum: ['Dispatched', 'In-Transit', 'Delivered', 'Returned'] //[cite: 24]
  }
});

// Maps to the "Delivery team" relational table linking Staff (Courier) to Parcels
const deliveryTeamSchema = new mongoose.Schema({
  staff_id: { type: Number, ref: 'Staff', required: true }, //[cite: 19]
  parcel_id: { type: Number, ref: 'Parcel', required: true } //[cite: 19]
});

const paymentSchema = new mongoose.Schema({
  payment_id: { type: Number, required: true, unique: true }, //[cite: 24]
  booking_id: { type: Number, ref: 'Booking', required: true }, //[cite: 24]
  payment_method: { 
    type: String, 
    required: true, 
    enum: ['COD', 'Card', 'E-wallet'] //[cite: 24]
  },
  amount: { type: Number, required: true, min: 0.01 }, //[cite: 24]
  payment_status: { 
    type: String, 
    required: true, 
    enum: ['Paid', 'Pending', 'Failed'] //[cite: 24]
  },
  transaction_date: { type: Date, required: true } //[cite: 24]
});

module.exports = {
  Booking: mongoose.model('Booking', bookingSchema),
  Parcel: mongoose.model('Parcel', parcelSchema),
  DeliveryTeam: mongoose.model('DeliveryTeam', deliveryTeamSchema),
  Payment: mongoose.model('Payment', paymentSchema)
};