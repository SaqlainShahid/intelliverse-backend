const rateLimit = require('express-rate-limit');

// OTP rate limiter - prevents spam
const otpRateLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 5, // 5 requests per windowMs
  message: {
    success: false,
    message: 'Too many OTP requests. Please try again later.',
    retryAfter: Math.ceil((parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000) / 60000)
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Fix for IPv6 issue - use email from body if available, otherwise fall back to IP
  keyGenerator: (req) => {
    return req.body.email || req.ip;
  },
  // Skip successful requests from counting towards limit
  skipSuccessfulRequests: false
});

// General API rate limiter
const generalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false
});

module.exports = {
  otpRateLimiter,
  generalRateLimiter
};