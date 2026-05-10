const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const classroomController = require('../controllers/classroomController');
const { upload } = require('../utils/cloudinary');

// All routes require authentication
router.use(authenticate);

// Faculty & Student shared
router.get('/my-classes', classroomController.getMyClasses);
router.get('/details/:classId', classroomController.getClassDetails);

// File Upload Utility (Shared)
router.post('/upload-file', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      console.error('Multer/Cloudinary Error:', err);
      return res.status(500).json({ success: false, message: err.message || 'File upload failed' });
    }
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });
    
    res.status(200).json({ 
      success: true, 
      fileUrl: req.file.path, 
      fileType: req.file.mimetype?.split('/')[1] || 'raw'
    });
  });
});

// Faculty & HOD
router.post('/create', authorize('faculty', 'hod'), classroomController.createClass);
router.post('/upload-material/:classId', authorize('faculty', 'hod'), classroomController.uploadMaterial);
router.post('/post-announcement/:classId', authorize('faculty', 'hod'), classroomController.postAnnouncement);
router.post('/create-assignment/:classId', authorize('faculty', 'hod'), classroomController.createAssignment);
router.post('/add-topic/:classId', authorize('faculty', 'hod'), classroomController.addTopic);
router.post('/grade-submission/:classId/:assignmentId/:submissionId', authorize('faculty', 'hod'), classroomController.gradeSubmission);

// Student only
router.post('/join', authorize('student'), classroomController.joinClass);
router.post('/submit-assignment/:classId/:assignmentId', authorize('student'), classroomController.submitAssignment);

module.exports = router;
