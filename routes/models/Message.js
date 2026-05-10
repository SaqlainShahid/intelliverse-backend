const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    chat: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    content: { type: String, default: '', trim: true },
    type: { type: String, enum: ['text', 'poll', 'system'], default: 'text' },
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
    attachments: [
      {
        url: { type: String, required: true },
        publicId: { type: String, required: true },
        mimeType: { type: String, required: true },
        bytes: { type: Number, required: true },
        filename: { type: String, required: true },
        kind: { type: String, enum: ['image', 'video', 'audio', 'pdf', 'file'], default: 'file' }
      }
    ],
    status: { type: String, enum: ['sent', 'delivered', 'seen'], default: 'sent' },
    deliveredAt: { type: Date, default: null },
    seenAt: { type: Date, default: null },
    editedAt: { type: Date, default: null },
    editCount: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    deletedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    receipts: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        status: { type: String, enum: ['delivered', 'read'], required: true },
        deliveredAt: { type: Date, default: null },
        readAt: { type: Date, default: null }
      }
    ],
    reactions: [
      {
        emoji: { type: String, required: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        createdAt: { type: Date, default: Date.now }
      }
    ],
    audit: [
      {
        action: { type: String, enum: ['edit', 'delete', 'restore'], required: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        at: { type: Date, default: Date.now },
        meta: { type: mongoose.Schema.Types.Mixed, default: null }
      }
    ],
    poll: {
      question: { type: String, default: null },
      options: [
        {
          text: { type: String, required: true },
          votes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
        }
      ],
      multiple: { type: Boolean, default: false },
      deadline: { type: Date, default: null },
      closed: { type: Boolean, default: false }
    }
  },
  { timestamps: true }
);

messageSchema.index({ chat: 1, createdAt: 1 });
messageSchema.index({ recipient: 1, status: 1 });
messageSchema.index({ 'receipts.user': 1, 'receipts.status': 1 });
messageSchema.index({ replyTo: 1 });
messageSchema.index({ type: 1 });

module.exports = mongoose.model('Message', messageSchema);
