const mongoose = require('mongoose');

const querySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: true
  },
  tag: {
    type: String,
    enum: ['IT', 'Finance', 'Exams', 'Admissions', 'Hostel', 'Library', 'Career', 'Other'],
    required: true
  },
  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  },
  originDepartment: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    default: null
  },
  collaboratingDepartments: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department'
  }],
  collaboratorStatuses: [{
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department' },
    status: { type: String, enum: ['pending', 'resolved'], default: 'pending' },
    updatedAt: { type: Date, default: Date.now }
  }],
  transfers: [{
    fromDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    toDepartment: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    note: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  }],
  status: {
    type: String,
    enum: ['answered', 'pending', 'escalated', 'resolved'],
    default: 'pending'
  },
  ownerStatus: {
    type: String,
    enum: ['pending', 'resolved'],
    default: 'pending'
  },
  aiConfidence: {
    type: Number,
    default: 0
  },
  aiResponse: {
    type: String
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  resolution: {
    type: String
  },
  topicTags: [{
    type: String,
    enum: ['Fee', 'Transcript', 'Internship', 'Scholarship', 'Registration', 'Grading', 'Course Drop', 'Leave', 'Hostel', 'Other']
  }],
  history: [{
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // or 'AI' if sender is null/system
    message: String,
    createdAt: { type: Date, default: Date.now }
  }]
}, {
  timestamps: true
});

module.exports = mongoose.model('Query', querySchema);