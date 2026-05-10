const mongoose = require('mongoose');

const ClassroomSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Class name is required'],
    trim: true
  },
  section: {
    type: String,
    trim: true
  },
  code: {
    type: String,
    unique: true,
    required: true
  },
  faculty: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  students: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  topics: [{
    type: String,
    trim: true
  }],
  materials: [{
    title: { type: String, required: true },
    description: String,
    fileUrl: String,
    fileType: { type: String, default: 'pdf' },
    topic: String,
    uploadedAt: { type: Date, default: Date.now }
  }],
  assignments: [{
    title: { type: String, required: true },
    description: String,
    dueDate: Date,
    maxPoints: { type: Number, default: 100 },
    fileUrl: String, // Reference material for assignment
    topic: String,
    submissions: [{
      student: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      fileUrl: String,
      content: String,
      submittedAt: { type: Date, default: Date.now },
      grade: Number,
      feedback: String
    }],
    createdAt: { type: Date, default: Date.now }
  }],
  announcements: [{
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Pre-save hook to generate code if not provided
ClassroomSchema.pre('validate', function(next) {
  if (!this.code) {
    this.code = Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('Classroom', ClassroomSchema);
