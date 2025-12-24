const mongoose = require('mongoose');

const internshipSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true },
    company: { type: String, required: [true, 'Company is required'], trim: true },
    location: { type: String, required: [true, 'Location is required'], trim: true },
    type: { type: String, enum: ['internship', 'job'], required: [true, 'Type is required'] },
    skillsRequired: [{ type: String, trim: true }],
    stipend: { type: String, default: null },
    eligibility: { type: String, default: '' },
    deadline: { type: Date, default: null },
    applyLink: { type: String, required: [true, 'Apply link is required'], trim: true },
    description: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    status: { type: String, enum: ['draft','pending','approved','rejected'], default: 'pending', index: true },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    verifiedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

internshipSchema.index({ title: 'text', company: 'text', location: 'text', eligibility: 'text', description: 'text', skillsRequired: 'text' });
internshipSchema.index({ deadline: 1 });
internshipSchema.index({ type: 1, location: 1 });

module.exports = mongoose.model('Internship', internshipSchema);

