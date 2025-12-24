const express = require('express');
const { authenticate, authorize, tryAuthenticate } = require('../middleware/auth');
const { getClubs, getClub, createClub, updateClub, deleteClub, joinClub, leaveClub, generateClubQr, resolveClubByCode, announceClub, approveClub, rejectClub } = require('../controllers/clubController');
const { upload } = require('../middleware/upload');

const router = express.Router();

router.get('/', tryAuthenticate, getClubs);
router.get('/resolve', resolveClubByCode);
router.get('/:id', getClub);

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
router.delete('/:id', authenticate, authorize('admin'), deleteClub);
router.post('/:id/join', authenticate, joinClub);
router.post('/:id/leave', authenticate, leaveClub);
router.post('/:id/qr', authenticate, generateClubQr);
router.get('/resolve', resolveClubByCode);
router.post('/:id/announce', authenticate, announceClub);
router.patch('/:id/approve', authenticate, authorize('admin','faculty'), approveClub);
router.patch('/:id/reject', authenticate, authorize('admin','faculty'), rejectClub);

module.exports = router;
