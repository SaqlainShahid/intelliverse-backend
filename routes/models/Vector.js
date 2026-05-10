const mongoose = require('mongoose');

const vectorSchema = new mongoose.Schema({
  chunkId: { type: String, unique: true, index: true },
  chunk: { type: String, required: true },
  embedding: { type: [Number], default: [] },
  page: { type: Number, default: null },
  source: { type: String, default: 'AU_Academic_Regulations.pdf' },
  wordCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Vector', vectorSchema);
