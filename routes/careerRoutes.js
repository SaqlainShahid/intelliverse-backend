const express = require('express');
const { authenticate, authorize } = require('../middleware/auth');
const {
  getInternships,
  getTips,
  chatCareer,
  getChatHistory,
  clearChatHistory,
  improveResume,
  createInternship,
  updateInternship,
  deleteInternship,
  listManageInternships,
  changeInternshipStatus,
  applyInternship,
  listApplications,
  updateApplication,
  listMyApplications,
} = require('../controllers/careerController');

const router = express.Router();

router.get('/internships', authenticate, authorize('student'), getInternships);
router.get('/tips', authenticate, authorize('student'), getTips);
router.post('/chat', authenticate, authorize('student'), chatCareer);
router.get('/chat/history', authenticate, authorize('student'), getChatHistory);
router.delete('/chat/history', authenticate, authorize('student'), clearChatHistory);
router.post('/resume/improve', authenticate, authorize('student'), improveResume);

router.post('/internships', authenticate, authorize('admin','faculty','hod'), createInternship);
router.put('/internships/:id', authenticate, authorize('admin','faculty','hod'), updateInternship);
router.delete('/internships/:id', authenticate, authorize('admin','faculty','hod'), deleteInternship);
router.get('/internships/manage', authenticate, authorize('admin','faculty','hod'), listManageInternships);
router.patch('/internships/:id/status', authenticate, authorize('admin','hod'), changeInternshipStatus);

router.post('/internships/:id/apply', authenticate, authorize('student'), applyInternship);
router.get('/applications', authenticate, authorize('admin','faculty','hod'), listApplications);
router.patch('/applications/:id', authenticate, authorize('admin','faculty','hod'), updateApplication);
router.get('/applications/my', authenticate, authorize('student'), listMyApplications);

module.exports = router;
