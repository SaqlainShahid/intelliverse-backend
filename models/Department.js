const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
    enum: ['IT', 'Finance', 'Exams', 'Admissions', 'Hostel', 'Library', 'Career', 'Other'],
    trim: true
  },
  admins: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  keywords: [{
    type: String,
    trim: true
  }],
  faqs: [{
    question: { type: String, required: true },
    answer: { type: String, required: true },
    keywords: [String]
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Department', departmentSchema);