const mongoose = require('mongoose');

const otpVerificationSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true
  },
  otpCode: {
    type: String,
    required: [true, 'OTP code is required'],
    length: 6
  },
  purpose: {
    type: String,
    enum: {
      values: ['signup', 'login', 'reset_password'],
      message: 'Purpose must be signup, login, or reset_password'
    },
    required: [true, 'Purpose is required']
  },
  expiresAt: {
    type: Date,
    required: [true, 'Expiry time is required'],
    index: { expireAfterSeconds: 0 } // TTL index
  },
  isUsed: {
    type: Boolean,
    default: false
  },
  attempts: {
    type: Number,
    default: 0,
    max: [3, 'Maximum 3 attempts allowed']
  }
}, {
  timestamps: true
});

// Index for efficient queries
otpVerificationSchema.index({ email: 1, purpose: 1 });

module.exports = mongoose.model('OtpVerification', otpVerificationSchema);