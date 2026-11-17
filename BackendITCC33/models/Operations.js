const mongoose = require('mongoose');

const branchSchema = new mongoose.Schema({
  branch_id: { type: Number, required: true, unique: true }, //[cite: 22]
  branch_name: { type: String, required: true, maxlength: 100 }, //[cite: 22]
  address: { type: String, required: true, maxlength: 255 }, //[cite: 22]
  contact_information: { type: String, required: true, maxlength: 50 } //[cite: 22]
});

const staffSchema = new mongoose.Schema({
  staff_id: { type: Number, required: true, unique: true }, //[cite: 22]
  branch_id: { type: Number, ref: 'Branch', required: true }, //[cite: 22]
  name: { type: String, required: true, maxlength: 100 }, //[cite: 22]
  role: { 
    type: String, 
    required: true, 
    enum: ['Warehouse Manager', 'Courier', 'Admin', 'Staff'] //[cite: 22]
  },
  permission_level: { 
    type: String, 
    required: true, 
    enum: ['Admin', 'Manager', 'Courier'] //[cite: 23]
  }
});

module.exports = {
  Branch: mongoose.model('Branch', branchSchema),
  Staff: mongoose.model('Staff', staffSchema)
};