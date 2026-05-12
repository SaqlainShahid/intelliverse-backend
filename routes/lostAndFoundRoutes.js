const express = require('express');
const router = express.Router();
const {
  getAllItems,
  reportItem,
  claimItem,
  reportItemWithImage,
  deleteItem,
  updateItemStatus,
  setItemApproval
} = require('../controllers/lostAndFoundController');
const { lostAndFoundUpload } = require('../utils/cloudinary'); // Cloudinary upload for lost & found
const { authenticate, authorize } = require('../middleware/auth');

// 🔐 All routes now require authentication

// Get all items - authenticated users can view all items
router.get('/', authenticate, getAllItems);

// Report item without image - authenticated users can report items
router.post('/', authenticate, reportItem);

// Claim item - authenticated users can claim found items
router.put('/:id/claim', authenticate, claimItem);

// Report item with image - authenticated users can report items with images
router.post(
  '/with-image',
  authenticate, // Add authentication first
  (req, res, next) => {
    lostAndFoundUpload.single('image')(req, res, function (err) {
      if (err) {
        return res.status(400).json({
          success: false,
          message: err.message || 'File upload failed',
        });
      }
      next();
    });
  },
  reportItemWithImage
);

// Update item status - authenticated users can update status (only if they reported it)
router.put('/:id/status', authenticate, updateItemStatus);

router.patch('/:id/approval', authenticate, authorize('admin'), setItemApproval);

// Delete item - Admin only
router.delete('/:id', authenticate, authorize('admin'), deleteItem);

module.exports = router;
