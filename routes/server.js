const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
require('dotenv').config();

// Import database connection
const connectDB = require('./config/database');
const mongoose = require('mongoose');

// Import email service verification
const { verifyEmailConfig } = require('./utils/emailService');

// Import routes
const authRoutes = require('./routes/auth');
const lostAndFoundRoutes = require('./routes/lostAndFoundRoutes');
const eventRoutes = require('./routes/eventRoutes');
const clubRoutes = require('./routes/clubRoutes');
const helpdeskRoutes = require('./routes/helpdeskRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');
const chatRoutes = require('./routes/chatRoutes');
const p2pChatRoutes = require('./routes/p2pChatRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const userRoutes = require('./routes/userRoutes');

// Import middleware
const { generalRateLimiter } = require('./middleware/rateLimiter');

// Initialize Express app
const app = express();

// Connect to MongoDB
connectDB();

// Verify email service configuration
verifyEmailConfig();

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS configuration
app.use(
  cors({
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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token'],
  })
);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Static file uploads
app.use('/uploads', express.static('uploads'));

// Rate limiting
app.use(generalRateLimiter);

// Request logging middleware (development only)
if (process.env.NODE_ENV === "development") {
  app.use((req, res, next) => {
    let bodyKeys = "empty";

    if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
      const keys = Object.keys(req.body);
      bodyKeys = keys.length ? keys : "empty";
    }

    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`, {
      body: bodyKeys,
      ip: req.ip,
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
    environment: process.env.NODE_ENV,
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/lost', lostAndFoundRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/clubs', clubRoutes);
app.use('/api/helpdesk', helpdeskRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api', chatRoutes);
app.use('/api/p2p', p2pChatRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/user', userRoutes);

// ✅ Fixed 404 handler (safe with path-to-regexp)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    path: req.originalUrl,
  });
});

// Global error handler
app.use((error, req, res, next) => {
  console.error('Global Error Handler:', {
    message: error.message,
    stack: error.stack,
    url: req.url,
    method: req.method,
  });

  res.status(error.statusCode || 500).json({
    success: false,
    message:
      process.env.NODE_ENV === 'development'
        ? error.message
        : 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: error.stack }),
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

  // One-time index migration to ensure qrCode uses sparse unique index
  (async () => {
    try {
      const db = mongoose.connection.db;
      if (!db) return;
      const coll = db.collection('events');
      const indexes = await coll.indexes();
      const qrIndex = indexes.find((i) => i.name === 'qrCode_1');

      // Always try to drop the existing qrCode index if present
      if (qrIndex) {
        try {
          console.log('⚙️ Dropping existing events.qrCode index:', qrIndex);
          await coll.dropIndex('qrCode_1');
        } catch (dropErr) {
          console.warn('Skip drop qrCode_1:', dropErr.message);
        }
      }

      // Clean up documents where qrCode is explicitly null so sparse index won't include them
      try {
        const res = await coll.updateMany({ qrCode: null }, { $unset: { qrCode: "" } });
        if (res?.modifiedCount) {
          console.log(`✅ Unset qrCode=null on ${res.modifiedCount} event(s)`);
        }
      } catch (unsetErr) {
        console.warn('Unset qrCode null failed:', unsetErr.message);
      }

      // Do not recreate qrCode index (field removed)
    } catch (e) {
      console.warn('Index migration skipped or failed:', e.message);
    }
  })();
});

// Initialize Socket.IO
try {
  const { initSocket } = require('./socket');
  initSocket(server);
  console.log('🔌 Socket.IO initialized');
} catch (e) {
  console.warn('Socket.IO init skipped or failed:', e.message);
}
const { initSocket } = require('./socket');
const io = initSocket(server);

// Scheduled jobs
try {
  const { sendUpcomingReminders } = require('./controllers/eventController');
  const run24hReminders = () => {
    (async () => {
      try {
        const req = {};
        const res = {
          status: (code) => ({
            json: (payload) => {
              const info = payload?.data || {};
              console.log(`⏰ 24h reminders job -> sent=${info.remindersSent || 0}, events=${info.eventsProcessed || 0}`);
            }
          })
        };
        await sendUpcomingReminders(req, res);
      } catch (e) {
        console.warn('24h reminders job failed:', e.message);
      }
    })();
  };
  setTimeout(run24hReminders, 30 * 1000);
  setInterval(run24hReminders, 60 * 60 * 1000);
  console.log('🗓️ Scheduled 24h reminders: runs hourly');
} catch (e) {
  console.warn('Schedule init skipped:', e.message);
}

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
