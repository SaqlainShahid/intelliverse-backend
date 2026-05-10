const mongoose = require('mongoose');

const chatRequestSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined', 'blocked'],
      default: 'pending',
      index: true
    },
    message: {
      type: String,
      default: null,
      maxlength: 500
    },
    declinedAt: {
      type: Date,
      default: null
    },
    acceptedAt: {
      type: Date,
      default: null
    },
    blockedAt: {
      type: Date,
      default: null
    },
    // Track if this has been read by receiver
    read: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

// Ensure only one pending request between two users
chatRequestSchema.index(
  { sender: 1, receiver: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: 'pending' } }
);

// For quick lookups of incoming requests
chatRequestSchema.index({ receiver: 1, status: 1, createdAt: -1 });

// For quick lookups of outgoing requests
chatRequestSchema.index({ sender: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('ChatRequest', chatRequestSchema);
