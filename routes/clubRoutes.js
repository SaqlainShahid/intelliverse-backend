const express = require('express');
const { authenticate, authorize, tryAuthenticate, requireCentralApprover } = require('../middleware/auth');
const { getClubs, getClub, createClub, updateClub, deleteClub, joinClub, leaveClub, generateClubQr, resolveClubByCode, announceClub, approveClub, rejectClub, getPendingClubs } = require('../controllers/clubController');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.get('/', tryAuthenticate, getClubs);
router.get('/resolve', resolveClubByCode);
router.get('/:id', tryAuthenticate, getClub);

router.post('/', authenticate, (req, res, next) => {
  upload.single('image')(req, res, function (err) {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'File upload failed' });
    }
    next();
  });
}, createClub);

router.put('/:id', authenticate, (req, res, next) => {
  upload.single('image')(req, res, function (err) {
    if (err) {
      return res.status(400).json({ success: false, message: err.message || 'File upload failed' });
    }
    next();
  });
}, updateClub);
router.delete('/:id', authenticate, deleteClub);
router.post('/:id/join', authenticate, joinClub);
router.post('/:id/leave', authenticate, leaveClub);
router.post('/:id/qr', authenticate, generateClubQr);
router.get('/resolve', resolveClubByCode);
router.post('/:id/announce', authenticate, announceClub);

// Centralized approval workflow
router.get('/pending', authenticate, requireCentralApprover, getPendingClubs);
router.put('/:id/approve', authenticate, requireCentralApprover, approveClub);
router.put('/:id/reject', authenticate, requireCentralApprover, rejectClub);
router.patch('/:id/approve', authenticate, requireCentralApprover, approveClub);
router.patch('/:id/reject', authenticate, requireCentralApprover, rejectClub);

module.exports = router;
