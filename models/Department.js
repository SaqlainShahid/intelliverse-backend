const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
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