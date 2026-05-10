const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['new_message', 'group_added', 'mention', 'helpdesk_new_ticket', 'helpdesk_status_update', 'helpdesk_comment', 'lost_item_reported', 'lost_item_found', 'lost_item_claimed', 'event_reminder', 'event_feedback_request', 'event_checkin', 'event_announcement', 'club_announcement', 'event_waitlist_promoted'], required: true },
    title: { type: String, default: null },
    message: { type: String, default: null },
    data: { type: Object, default: {} },
    isRead: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: null }
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
