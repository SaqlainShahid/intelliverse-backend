const mongoose = require('mongoose');

const collabRequestSchema = new mongoose.Schema({
  requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title:       { type: String, required: true, trim: true, maxlength: 150 },
  description: { type: String, required: true, trim: true },
  topic:       { type: String, trim: true, default: null },
  targetDepartments: [{ type: String }],   // empty = open to all
  targetRoles: [{
    type: String,
    enum: ['student', 'faculty', 'hod'],
    default: 'faculty'
  }],
  status: { type: String, enum: ['open', 'closed'], default: 'open' },
  respondents: [{
    user:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    message:     { type: String, default: '' },
    status:      { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    respondedAt: { type: Date, default: Date.now }
  }],
  teamChatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', default: null },
}, { timestamps: true });

collabRequestSchema.index({ status: 1, createdAt: -1 });
collabRequestSchema.index({ requestedBy: 1 });

module.exports = mongoose.model('CollabRequest', collabRequestSchema);
