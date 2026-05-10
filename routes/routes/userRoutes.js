const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const User = require('../models/User');

router.use(authenticate);

router.put('/settings', async (req, res) => {
  try {
    const { displayName, avatar, notificationsEnabled } = req.body || {};
    const update = {};
    if (typeof displayName === 'string') update['profile.displayName'] = displayName.trim() || null;
    if (typeof avatar === 'string') update['profile.avatar'] = avatar;
    if (typeof notificationsEnabled === 'boolean') update['preferences.notificationsEnabled'] = notificationsEnabled;
    if (!Object.keys(update).length) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }
    const user = await User.findByIdAndUpdate(req.user._id, { $set: update }, { new: true });
    res.json({ success: true, data: { user } });
  } catch (e) {
    res.status(500).json({ success: false, message: 'Failed to update settings' });
  }
});

module.exports = router;

