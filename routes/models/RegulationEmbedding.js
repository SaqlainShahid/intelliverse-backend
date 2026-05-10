const mongoose = require('mongoose');

const regulationEmbeddingSchema = new mongoose.Schema({
  chunkId: { type: String, index: true, unique: true },
  text: { type: String, required: true },
  embedding: { type: [Number], required: true },
  source: { type: String, default: 'AU_Academic_Regulations.pdf' },
  length: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('RegulationEmbedding', regulationEmbeddingSchema);

