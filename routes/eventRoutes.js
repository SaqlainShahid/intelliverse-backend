const express = require('express');
const { getEvents, getEvent, createEvent, updateEvent, deleteEvent, joinEvent, leaveEvent, getEventCategories, generateEventQr, checkInEvent, submitEventFeedback, getEventFeedback, sendUpcomingReminders, resolveEventByCode, getEventIcs, downloadAttendeesCsv, announceEvent, approveEvent, rejectEvent, getPendingEvents } = require('../controllers/eventController');
const { authenticate, authorize, tryAuthenticate, requireCentralApprover } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

const router = express.Router();

// Public / general listing
router.get('/', tryAuthenticate, getEvents);
router.get('/categories', getEventCategories);
router.get('/resolve', resolveEventByCode);
router.get('/:id', tryAuthenticate, getEvent);
router.get('/:id/ics', getEventIcs);
router.get('/:id/attendees.csv', authenticate, downloadAttendeesCsv);
router.post('/:id/announce', authenticate, announceEvent);

// Protected
router.post('/', authenticate, (req, res, next) => {
  upload.single('image')(req, res, function (err) {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'File upload failed' });
    }
    next();
  });
}, createEvent);

router.put('/:id', authenticate, (req, res, next) => {
  upload.single('image')(req, res, function (err) {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'File upload failed' });
    }
    next();
  });
}, updateEvent);
router.delete('/:id', authenticate, deleteEvent);
router.post('/:id/join', authenticate, joinEvent);
router.post('/:id/leave', authenticate, leaveEvent);
router.post('/:id/qr', authenticate, generateEventQr);
router.post('/:id/checkin', authenticate, checkInEvent);
router.post('/:id/feedback', authenticate, submitEventFeedback);
router.get('/:id/feedback', authenticate, getEventFeedback);
router.post('/reminders/send', authenticate, authorize('admin','faculty','hod'), sendUpcomingReminders);

// Centralized approval workflow
router.get('/pending', authenticate, requireCentralApprover, getPendingEvents);
router.put('/:id/approve', authenticate, requireCentralApprover, approveEvent);
router.put('/:id/reject', authenticate, requireCentralApprover, rejectEvent);
router.patch('/:id/approve', authenticate, requireCentralApprover, approveEvent);
router.patch('/:id/reject', authenticate, requireCentralApprover, rejectEvent);

module.exports = router;
