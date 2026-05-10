const mongoose = require('mongoose');

const attendeeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const eventSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true },
    description: { type: String, default: '' },
    date: { type: Date, required: [true, 'Date is required'] },
    time: { type: String, default: '' },
    location: { type: String, default: '' },
    category: { type: String, default: 'General' },
    status: { type: String, enum: ['upcoming','ongoing','completed','cancelled'], default: 'upcoming' },
    maxAttendees: { type: Number, default: 0 },
    tags: [{ type: String, trim: true }],
    requirements: [{ type: String, trim: true }],
    image: { type: String, default: null },


    organizer: { type: mongoose.Schema.Types.ObjectId, ref: 'Club', required: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    attendees: { type: [attendeeSchema], default: [] },
    qrCode: { type: String, default: null },
    qrCodeExpires: { type: Date, default: null },
    checkIns: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      checkedAt: { type: Date, default: Date.now },
      method: { type: String, enum: ['qr','manual'], default: 'qr' }
    }],
    checkInCount: { type: Number, default: 0 },
    feedbacks: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      rating: { type: Number, min: 1, max: 5 },
      comment: { type: String, trim: true, default: '' },
      submittedAt: { type: Date, default: Date.now }
    }],
    reminderSentFor24h: { type: Boolean, default: false },
    waitlist: [{
      user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      addedAt: { type: Date, default: Date.now }
    }]
  },
  { timestamps: true }
);

// Derived field frequently used in sorting
eventSchema.virtual('attendeeCount').get(function () {
  return Array.isArray(this.attendees) ? this.attendees.length : 0;
});

eventSchema.index({ date: 1 });
eventSchema.index({ category: 1 });
eventSchema.index({ title: 'text', description: 'text', tags: 'text' });

module.exports = mongoose.model('Event', eventSchema);


