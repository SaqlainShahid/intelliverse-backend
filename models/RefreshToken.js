const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'User ID is required']
  },
  token: {
    type: String,
    required: [true, 'Token is required'],
    unique: true
  },
  deviceInfo: {
    deviceId: {
      type: String,
      default: null
    },
    deviceType: {
      type: String,
      enum: ['mobile', 'web', 'desktop'],
      default: 'web'
    },
    userAgent: {
      type: String,
      default: null
    }
  },
  expiresAt: {
    type: Date,
    required: [true, 'Expiry time is required'],
    index: { expireAfterSeconds: 0 } // TTL index
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Indexes for efficient queries
refreshTokenSchema.index({ userId: 1 });
refreshTokenSchema.index({ token: 1 }, { unique: true });

module.exports = mongoose.model('RefreshToken', refreshTokenSchema);