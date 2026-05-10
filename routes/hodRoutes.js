const express = require('express');
const router = express.Router();
const hodController = require('../controllers/hodController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require authentication and HOD role
router.use(authenticate, authorize('hod'));

// Get pending faculty approvals
router.get('/pending-faculty', hodController.getPendingFaculty);

// Get approved faculty members
router.get('/approved-faculty', hodController.getApprovedFaculty);

// Approve faculty member
router.post('/approve/:facultyId', hodController.approveFaculty);

// Reject faculty member
router.post('/reject/:facultyId', hodController.rejectFaculty);

// Get HOD dashboard statistics
router.get('/stats', hodController.getHodStats);

// Get all students in department
router.get('/students', hodController.getStudents);

// Perform disciplinary/administrative action
router.post('/perform-action', hodController.performAction);

module.exports = router;
