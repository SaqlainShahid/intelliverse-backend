const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const facultyController = require('../controllers/facultyController');

// All routes require authentication and faculty/hod role
router.use(authenticate, authorize('faculty', 'hod'));

// Get faculty statistics
router.get('/stats', facultyController.getStats);

// Get faculty classes
router.get('/classes', facultyController.getClasses);

// Get faculty students (from same department)
router.get('/students', facultyController.getStudents);

module.exports = router;
