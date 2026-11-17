const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Import all models
const { Customer, Retail, ECommerce, NonProfit } = require('./models/Customer');
const { Branch, Staff } = require('./models/Operations');
const { Booking, Parcel, DeliveryTeam, Payment } = require('./models/Transactions');
const Complaint = require('./models/Complaint');

const app = express();
const PORT = 5000;

app.use(express.json());
app.use(cors());

const mongoURI = 'mongodb://localhost:27017/freight_flow';
mongoose.connect(mongoURI)
  .then(() => console.log('✅ Connected to MongoDB (freight_flow)'))
  .catch((err) => console.error('❌ MongoDB connection error:', err));

// ==========================================
// 1. PARCELS & BOOKINGS (CREATE, READ, UPDATE, DELETE)
// ==========================================

// READ all parcels
app.get('/api/parcels', async (req, res) => {
  try {
    const parcels = await Parcel.find().sort({ parcel_id: -1 });
    res.json(parcels);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE a new parcel (and auto-generate matching Booking & Payment records)
app.post('/api/parcels', async (req, res) => {
  try {
    const { item_name, weight, tracking_number, sender_id, receiver_id, payment_method, amount } = req.body;
    
    // Generate unique numeric IDs matching your schema
    const uniqueNum = Math.floor(1000 + Math.random() * 9000);

    const newBooking = new Booking({
      booking_id: uniqueNum,
      customer_id: sender_id || 101,
      branch_id: 1,
      booking_status: 'Pending'
    });
    await newBooking.save();

    const newParcel = new Parcel({
      parcel_id: uniqueNum,
      booking_id: uniqueNum,
      sender_id: sender_id || 101,
      receiver_id: receiver_id || 101,
      tracking_number: tracking_number || `FF-CDO-2026-${uniqueNum}`,
      weight: Number(weight),
      item_name,
      current_status: 'Dispatched'
    });
    await newParcel.save();

    const newPayment = new Payment({
      payment_id: uniqueNum,
      booking_id: uniqueNum,
      payment_method: payment_method || 'COD',
      amount: Number(amount) || 150,
      payment_status: payment_method === 'COD' ? 'Pending' : 'Paid',
      transaction_date: new Date()
    });
    await newPayment.save();

    res.status(201).json(newParcel);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// UPDATE parcel status (Courier Queue)
app.put('/api/parcels/:tracking_number/status', async (req, res) => {
  try {
    const { status } = req.body; // Must be: 'Dispatched', 'In-Transit', 'Delivered', or 'Returned'
    const updated = await Parcel.findOneAndUpdate(
      { tracking_number: req.params.tracking_number },
      { current_status: status },
      { new: true }
    );
    if (!updated) return res.status(404).json({ error: 'Parcel not found' });
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE parcel
app.delete('/api/parcels/:tracking_number', async (req, res) => {
  try {
    const deleted = await Parcel.findOneAndDelete({ tracking_number: req.params.tracking_number });
    if (!deleted) return res.status(404).json({ error: 'Parcel not found' });
    res.json({ message: 'Parcel deleted', deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// 2. COMPLAINTS / CSR DESK (CREATE, READ, DELETE)
// ==========================================

// READ all complaints
app.get('/api/complaints', async (req, res) => {
  try {
    const complaints = await Complaint.find().sort({ created_at: -1 });
    res.json(complaints);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CREATE a complaint (Report Issue Modal)
app.post('/api/complaints', async (req, res) => {
  try {
    const { parcel_id, description, category } = req.body;
    const newComplaint = new Complaint({
      complaint_id: Math.floor(1000 + Math.random() * 9000),
      customer_id: 101,
      parcel_id: Number(parcel_id) || 1001,
      staff_id: 1,
      description,
      category: category || 'Delivery' // Must be 'Delivery' or 'Seller'
    });
    await newComplaint.save();
    res.status(201).json(newComplaint);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// DELETE / RESOLVE complaint
app.delete('/api/complaints/:complaint_id', async (req, res) => {
  try {
    const deleted = await Complaint.findOneAndDelete({ complaint_id: Number(req.params.complaint_id) });
    if (!deleted) return res.status(404).json({ error: 'Complaint not found' });
    res.json({ message: 'Complaint resolved and closed', deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => console.log(`🚀 Full CRUD API running on http://localhost:${PORT}`));