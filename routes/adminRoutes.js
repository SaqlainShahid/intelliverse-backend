const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require authentication, but some don't require admin role
router.use(authenticate);

// Get faculty list (admin or hod)
router.get('/faculty', authorize('admin', 'hod'), adminController.getFacultyList);

// Get all users (admin only)
router.get('/users', authorize('admin'), adminController.getAllUsers);

// Delete user (admin only)
router.delete('/users/:userId', authorize('admin'), adminController.deleteUser);

// Toggle user status (admin only)
router.post('/users/:userId/toggle-status', authorize('admin'), adminController.toggleUserStatus);

// Change user role (admin only)
router.post('/users/:userId/role', authorize('admin'), adminController.changeUserRole);

// Get HOD list (admin only)
router.get('/hods', authorize('admin'), adminController.getHodList);

// Assign faculty as HOD (admin only)
router.post('/assign-hod/:facultyId', authorize('admin'), adminController.assignHod);

// Remove HOD role (admin only)
router.post('/remove-hod/:hodId', authorize('admin'), adminController.removeHod);

// Event & Club Manager assignment (admin or hod)
router.get('/event-club-managers', authorize('admin', 'hod'), adminController.getEventClubManagers);
router.put('/event-manager/:id/assign', authorize('admin', 'hod'), adminController.assignEventManager);
router.put('/event-manager/:id/remove', authorize('admin', 'hod'), adminController.removeEventManager);

// Get admin statistics (admin or hod)
router.get('/stats', authorize('admin', 'hod'), adminController.getAdminStats);

// Get pending approvals by department (admin or hod)
router.get('/pending-approvals', authorize('admin', 'hod'), adminController.getPendingApprovalsbyDept);

// Get detailed analytics (admin or hod)
router.get('/analytics', authorize('admin', 'hod'), adminController.getDetailedAnalytics);

// Get users activity (admin only)
router.get('/users-activity', authorize('admin'), adminController.getUsersActivity);

// Get system health (admin only)
router.get('/system-health', authorize('admin'), adminController.getSystemHealth);

// Check for duplicate HODs (admin only)
router.get('/check-duplicate-hods', authorize('admin'), adminController.checkDuplicateHods);

// Announcement routes (admin or hod)
router.post('/announcements', authorize('admin', 'hod'), adminController.createAnnouncement);
router.get('/announcements', authorize('admin', 'hod'), adminController.getAnnouncements);
router.delete('/announcements/:id', authorize('admin', 'hod'), adminController.deleteAnnouncement);

// Department statistics (admin or hod)
router.get('/department-stats', authorize('admin', 'hod'), adminController.getDepartmentStats);

// Get department members (admin or hod)
router.get('/department/:departmentName/members', authorize('admin', 'hod'), adminController.getDepartmentMembers);

// Send bulk email (admin or hod)
router.post('/send-bulk-email', authorize('admin', 'hod'), adminController.sendBulkEmail);

// Send bulk message (admin or hod)
router.post('/send-bulk-message', authorize('admin', 'hod'), adminController.sendBulkMessage);

module.exports = router;
