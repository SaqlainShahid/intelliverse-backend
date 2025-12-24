const mongoose = require('mongoose');

const internshipApplicationSchema = new mongoose.Schema(
  {
    internshipId: { type: mongoose.Schema.Types.ObjectId, ref: 'Internship', required: true, index: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    status: { type: String, enum: ['applied','shortlisted','accepted','rejected'], default: 'applied', index: true },
    coverLetter: { type: String, default: '' },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

internshipApplicationSchema.index({ internshipId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('InternshipApplication', internshipApplicationSchema);

