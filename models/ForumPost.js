const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  body: { type: String, required: true, trim: true },
  upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isAccepted: { type: Boolean, default: false },
}, { timestamps: true });

const forumPostSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 200 },
  body: { type: String, required: true, trim: true },
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  category: {
    type: String,
    enum: ['Academic', 'Campus Life', 'Finance', 'Career', 'Events', 'Housing', 'Other'],
    default: 'Other'
  },
  upvotes: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  answers: [answerSchema],
  views: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['open', 'answered', 'forwarded'],
    default: 'open'
  },
  forwardedToFaculty: { type: Boolean, default: false },
  forwardedAt: { type: Date, default: null },
  forwardedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });

forumPostSchema.index({ category: 1, createdAt: -1 });
forumPostSchema.index({ author: 1 });
forumPostSchema.index({ title: 'text', body: 'text' });

module.exports = mongoose.model('ForumPost', forumPostSchema);
