const mongoose = require('mongoose');

const careerMessageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    content: { type: String, required: true },
    usedSkills: [{ type: String }],
    recommendedIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Internship' }],
    model: { type: String, default: 'llama-3.1-8b-instant' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('CareerMessage', careerMessageSchema);

