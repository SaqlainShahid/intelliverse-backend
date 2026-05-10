const mongoose = require('mongoose');

const clubSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide club name'],
    unique: true,
    trim: true,
    maxlength: [100, 'Club name cannot be more than 100 characters']
  },
  description: {
    type: String,
    required: [true, 'Please provide club description'],
    maxlength: [1000, 'Description cannot be more than 1000 characters']
  },
  category: {
    type: String,
    required: [true, 'Please provide club category'],
    enum: {
      values: ['Academic','Arts','Cultural','Creative','Business','Sports','Social Impact','Technology'],
      message: 'Please select a valid category'
    }
  },
  founded: {
    type: String,
    required: [true, 'Please provide founding year'],
    match: [/^\d{4}$/, 'Please provide a valid year (YYYY)']
  },
  president: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Please assign a president']
  },
  vicePresident: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  secretary: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  treasurer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  advisors: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  members: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    role: {
      type: String,
      enum: ['member','executive','admin'],
      default: 'member'
    },
    joinedAt: {
      type: Date,
      default: Date.now
    }
  }],
  image: {
    type: String,
    default: 'default-club.jpg'
  },
  logo: {
    type: String,
    default: 'default-logo.png'
  },
  qrCode: {
    type: String,
    default: null
  },
  qrCodeGeneratedAt: {
    type: Date,
    default: null
  },
  achievements: [{
    title: { type: String, required: true },
    description: String,
    year: String,
    createdAt: { type: Date, default: Date.now }
  }],
  tags: [{ type: String, trim: true }],
  socialLinks: {
    website: String,
    facebook: String,
    instagram: String,
    twitter: String,
    linkedin: String
  },
  contactInfo: {
    email: {
      type: String,
      match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
    },
    phone: String,
    office: String
  },
  meetingSchedule: {
    day: { type: String, enum: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] },
    time: String,
    location: String,
    frequency: { type: String, enum: ['Weekly','Bi-weekly','Monthly'], default: 'Weekly' }
  },
  membership: {
    isOpen: { type: Boolean, default: true },
    requirements: [String],
    fee: { type: Number, default: 0 }
  },
  events: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }],
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }
},{
  timestamps: true
});

clubSchema.index({ name: 'text', description: 'text' });
clubSchema.index({ category: 1 });
clubSchema.index({ president: 1 });

clubSchema.virtual('memberCount').get(function() { return this.members.length; });
clubSchema.virtual('upcomingEventsCount').get(function() { return this.events.length; });

clubSchema.methods.isMember = function(userId) { return this.members.some(m => m.user.toString() === userId.toString()); };
clubSchema.methods.getUserRole = function(userId) { const m = this.members.find(m => m.user.toString() === userId.toString()); return m ? m.role : null; };
clubSchema.methods.addMember = function(userId, role = 'member') { if (!this.isMember(userId)) { this.members.push({ user: userId, role }); return true; } return false; };
clubSchema.methods.removeMember = function(userId) { this.members = this.members.filter(m => m.user.toString() !== userId.toString()); };
clubSchema.methods.updateMemberRole = function(userId, newRole) { const m = this.members.find(m => m.user.toString() === userId.toString()); if (m) { m.role = newRole; return true; } return false; };

module.exports = mongoose.model('Club', clubSchema);


