const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Import database connection
const connectDB = require('./config/database');

// Import email service verification
const { verifyEmailConfig } = require('./utils/emailService');

// Import routes
const authRoutes = require('./routes/auth');

// Import middleware
const { generalRateLimiter } = require('./middleware/rateLimiter');

// Initialize Express app
const app = express();

// Connect to MongoDB
connectDB();

// Verify email service configuration
verifyEmailConfig();

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Allow requests with no origin

    const allowedOrigins = [
      'http://localhost:3000', // React dev server
      'http://localhost:19006', // Expo dev server
      'http://192.168.1.100:19006', // Local network Expo
      // Add your production domains here
    ];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all in development
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token']
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Rate limiting
app.use(generalRateLimiter);

// Request logging middleware (development only)
if (process.env.NODE_ENV === 'development') {
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`, {
      body: Object.keys(req.body).length ? Object.keys(req.body) : 'empty',
      ip: req.ip
    });
    next();
  });
}

// Health check route
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'IntelliVerse API is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// API Routes
app.use('/api/auth', authRoutes);

// ✅ Fixed 404 handler (safe with path-to-regexp)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global Error Handler:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'development'
      ? error.message
      : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
  });
});

// Start server
const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`
  🚀 IntelliVerse Backend Server Started
  =====================================
  📍 Port: ${PORT}
  🌍 Environment: ${process.env.NODE_ENV}
  📧 Email Service: ${process.env.EMAIL_USER}
  🕐 Started at: ${new Date().toISOString()}
  📖 API Documentation: http://localhost:${PORT}/health
  =====================================
  `);
});

// Graceful shutdown handling
process.on('SIGTERM', () => {
  console.log('🔴 SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    console.log('🔴 Process terminated');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n🔴 SIGINT received. Shutting down gracefully...');
  server.close(() => {
    console.log('🔴 Process terminated');
    process.exit(0);
  });
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('💥 UNCAUGHT EXCEPTION! Shutting down...');
  console.error(err.name, err.message);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('💥 UNHANDLED REJECTION! Shutting down...');
  console.error(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});

module.exports = app;
