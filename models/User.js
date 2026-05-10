const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    trim: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please enter a valid email']
  },
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: [6, 'Password must be at least 6 characters long']
  },
  role: {
    type: String,
    enum: {
      values: ['student', 'faculty', 'hod', 'admin'],
      message: 'Role must be student, faculty, hod, or admin'
    },
    required: [true, 'Role is required']
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isActive: {
    type: Boolean,
    default: true
  },
  // Faculty approval workflow
  isApproved: {
    type: Boolean,
    default: false // Faculty needs HOD approval
  },
  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null // HOD who approved this faculty
  },
  approvedAt: {
    type: Date,
    default: null
  },
  rejectionReason: {
    type: String,
    default: null
  },
  approvalStatus: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending' // Only for faculty
  },
  profile: {
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true
    },
    displayName: {
      type: String,
      default: null,
      trim: true
    },
    phone: {
      type: String,
      trim: true
    },
    avatar: {
      type: String,
      default: null
    },
    
    // Student-specific fields
    studentId: {
      type: String,
      sparse: true,
      trim: true
    },
    semester: {
      type: Number,
      min: 1,
      max: 8
    },
    cgpa: {
      type: Number,
      min: 0,
      max: 4
    },
    
    // Faculty-specific fields
    employeeId: {
      type: String,
      sparse: true,
      trim: true
    },
    designation: {
      type: String,
      trim: true
    },
    employeeType: {
      type: String,
      enum: ['permanent', 'visiting', null],
      default: null
    },
    officeRoom: {
      type: String,
      trim: true
    },
    
    // Common fields
    department: {
      type: String,
      required: [true, 'Department is required'],
      trim: true
    },
    campus: {
      type: String,
      default: 'Islamabad',
      trim: true
    }
  },
  // Faculty expertise tags
  expertise: [{ type: String, trim: true }],

  // Faculty weekly office hours
  officeHours: [{
    day: { type: String, enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] },
    startTime: { type: String },   // "09:00"
    endTime:   { type: String },   // "10:00"
    location:  { type: String },   // "Room 204-B" or "Online"
    isActive:  { type: Boolean, default: true }
  }],

  mutedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  archivedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }],
  deletedChats: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Chat' }],
  lastLogin: {
    type: Date,
    default: null
  },
  isEventClubManager: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  toJSON: { 
    transform: function(doc, ret) {
      delete ret.password;
      delete ret.__v;
      return ret;
    }
  }
});

// Events the user has joined
userSchema.add({
  joinedEvents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Event' }]
});

// Preferences
userSchema.add({
  preferences: {
    notificationsEnabled: { type: Boolean, default: true },
    emailNotifications:   { type: Boolean, default: true },
    darkMode:             { type: Boolean, default: false },
    twoFactorEnabled:     { type: Boolean, default: true }  // 2FA on by default
  }
});

// Privacy
userSchema.add({
  privacy: {
    profileVisibility: { type: String, enum: ['everyone', 'department', 'faculty_only', 'private'], default: 'everyone' },
    canMessage: { type: String, enum: ['everyone', 'department', 'faculty_only', 'none'], default: 'everyone' },
    shadowMuted: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, since: { type: Date, default: Date.now } }]
  }
});



// Hash password before saving
userSchema.pre('save', async function(next) {
  // Only hash password if it's modified (not on other updates)
  if (!this.isModified('password')) return next();
  
  try {
    // Hash password with cost of 12
    this.password = await bcrypt.hash(this.password, 12);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare password
userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get full name
userSchema.virtual('profile.fullName').get(function() {
  return `${this.profile.firstName} ${this.profile.lastName}`;
});

module.exports = mongoose.model('User', userSchema);
