const crypto = require('crypto');

const generateOTP = () => {
  // Generate 6-digit OTP
  return crypto.randomInt(100000, 999999).toString();
};

const generateOTPExpiry = (minutes = 10) => {
  return new Date(Date.now() + minutes * 60 * 1000);
};

const generateSecureToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

module.exports = {
  generateOTP,
  generateOTPExpiry,
  generateSecureToken
};  