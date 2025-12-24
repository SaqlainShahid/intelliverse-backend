const mongoose = require('mongoose');

const chatMessageSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true, required: true },
  role: { type: String, enum: ['user', 'assistant'], required: true },
  content: { type: String, required: true },
  confidence: { type: Number, default: 0 },
  sources: [
    {
      filename: { type: String },
      page: { type: Number }
    }
  ],
  sourceUrlRelative: { type: String, default: null },
  sourceUrl: { type: String, default: null },
}, { timestamps: true });

module.exports = mongoose.model('ChatMessage', chatMessageSchema);
