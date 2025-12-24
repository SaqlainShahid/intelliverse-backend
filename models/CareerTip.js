const mongoose = require('mongoose');

const careerTipSchema = new mongoose.Schema(
  {
    category: { type: String, enum: ['resume', 'interview', 'roadmap'], required: true },
    title: { type: String, required: true, trim: true },
    content: { type: String, required: true },
    tags: [{ type: String, trim: true }],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  },
  { timestamps: true }
);

careerTipSchema.index({ title: 'text', content: 'text', tags: 'text' });

module.exports = mongoose.model('CareerTip', careerTipSchema);

