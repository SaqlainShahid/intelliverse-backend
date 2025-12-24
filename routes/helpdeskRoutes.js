const express = require('express');
const router = express.Router();
const {
  getAllTickets,
  getTicketById,
  createTicket,
  updateTicket,
  addComment,
  submitFeedback,
  getTicketStats,
  deleteTicket,
  uploadAttachment,
  downloadAttachment
} = require('../controllers/helpdeskController');
const { authenticate } = require('../middleware/auth');
const { validateTicket, validateComment, validateFeedback, validateTicketUpdate } = require('../middleware/validation');
const { generalRateLimiter } = require('../middleware/rateLimiter');
const { uploadAttachment: uploadMiddleware } = require('../middleware/upload');
const { getEscalatedTickets, updateTicketStatus } = require('../controllers/helpdeskExtraController');

// Apply authentication to all routes
router.use(authenticate);

// Rate limiting for ticket creation
router.post('/', generalRateLimiter, validateTicket, createTicket);

// Get all tickets with filtering and pagination
router.get('/', getAllTickets);

// List escalated tickets (admin/faculty see all; students see their own)
router.get('/tickets', getEscalatedTickets);

// Get ticket statistics (admin/faculty only)
router.get('/stats', (req, res, next) => {
  if (req.user.role !== 'admin' && req.user.role !== 'faculty') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin or faculty role required.'
    });
  }
  next();
}, getTicketStats);

// Get single ticket by ID
router.get('/:id', getTicketById);

// Update ticket
router.put('/:id', validateTicketUpdate, updateTicket);

// Update ticket status (admin/faculty)
router.post('/update', updateTicketStatus);

// Add comment to ticket
router.post('/:id/comments', generalRateLimiter, validateComment, addComment);

// Submit feedback for ticket
router.post('/:id/feedback', validateFeedback, submitFeedback);

// Delete ticket (admin only)
router.delete('/:id', (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Access denied. Admin role required.'
    });
  }
  next();
}, deleteTicket);

// Upload attachment to ticket
router.post('/:id/attachments', uploadMiddleware.single('attachment'), uploadAttachment);

// Download attachment from ticket
router.get('/:id/attachments/:filename', downloadAttachment);

module.exports = router;
