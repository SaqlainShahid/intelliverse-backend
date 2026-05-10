const mongoose = require('mongoose');

const chatSchema = new mongoose.Schema(
  {
    chatType: { type: String, enum: ['private', 'group'], default: 'private', index: true },
    name: { type: String, default: null },
    description: { type: String, default: null },
    admins: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }],
    membersHash: { type: String, required: function () { return this.chatType === 'private'; } },
    category: { type: String, enum: ['department', 'batch', 'course', null], default: null },
    meta: {
      department: { type: String, default: null },
      batch: { type: String, default: null },
      course: { type: String, default: null }
    },
    settings: {
      announcementOnly: { type: Boolean, default: false },
      roleMentionsEnabled: { type: Boolean, default: true }
    },
    pinnedMessageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Message' }],
    lastMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

chatSchema.index({ participants: 1 });
chatSchema.index({ membersHash: 1 }, { unique: true, partialFilterExpression: { chatType: 'private' } });
chatSchema.index({ 'settings.announcementOnly': 1, chatType: 1 });

module.exports = mongoose.model('Chat', chatSchema);
