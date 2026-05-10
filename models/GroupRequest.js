const mongoose = require('mongoose');

const groupRequestSchema = new mongoose.Schema({
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, enum: ['department', 'batch', 'course'], required: true },
  key: { type: String, default: null },
  name: { type: String, default: null },
  description: { type: String, default: null },
  memberEmails: [{ type: String }],
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },
  rejectionReason: { type: String, default: null },
  resultChatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', default: null },
}, { timestamps: true });

module.exports = mongoose.model('GroupRequest', groupRequestSchema);
