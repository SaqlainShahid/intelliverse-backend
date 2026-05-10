


const mongoose = require('mongoose');

const ticketSchema = new mongoose.Schema({
  // Basic Information
  ticketNumber: {
    type: String,
    unique: true,
    required: false
  },
  title: {
    type: String,
    required: [true, 'Ticket title is required'],
    trim: true,
    maxlength: [200, 'Title cannot exceed 200 characters']
  },
  description: {
    type: String,
    required: [true, 'Ticket description is required'],
    trim: true,
    maxlength: [2000, 'Description cannot exceed 2000 characters']
  },
  
  // Classification
  category: {
    type: String,
    required: [true, 'Category is required'],
    enum: {
      values: [
        'academic',      // Transcript requests, enrollment letters, grade inquiries
        'administrative', // General admin requests
        'it_support',    // Technical issues, password resets, software problems
        'facilities',    // Building maintenance, room bookings
        'financial',     // Fee inquiries, payment issues, scholarships
        'library',       // Book requests, research assistance
        'transportation', // Bus schedules, parking issues
        'other'          // Miscellaneous requests
      ],
      message: 'Invalid category'
    }
  },
  subcategory: {
    type: String,
    trim: true
  },
  
  // Priority and Status
  priority: {
    type: String,
    enum: {
      values: ['low', 'medium', 'high', 'urgent'],
      message: 'Invalid priority level'
    },
    default: 'medium'
  },
  status: {
    type: String,
    enum: {
      values: ['open', 'in_progress', 'pending_user', 'resolved', 'closed', 'cancelled'],
      message: 'Invalid status'
    },
    default: 'open'
  },
  
  // Assignment and Routing
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  department: {
    type: String,
    required: [true, 'Department is required'],
    trim: true
  },
  
  // User Information
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Timestamps
  dueDate: {
    type: Date,
    default: function() {
      // Set due date based on priority
      const now = new Date();
      const priorityDays = {
        'urgent': 1,
        'high': 3,
        'medium': 7,
        'low': 14
      };
      return new Date(now.getTime() + (priorityDays[this.priority] * 24 * 60 * 60 * 1000));
    }
  },
  resolvedAt: {
    type: Date,
    default: null
  },
  closedAt: {
    type: Date,
    default: null
  },
  
  // Attachments and Files
  attachments: [{
    filename: String,
    originalName: String,
    path: String,
    size: Number,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Communication History
  comments: [{
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    message: {
      type: String,
      required: true,
      trim: true,
      maxlength: [1000, 'Comment cannot exceed 1000 characters']
    },
    isInternal: {
      type: Boolean,
      default: false // Internal notes visible only to staff
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Feedback and Rating
  feedback: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: {
      type: String,
      trim: true,
      maxlength: [500, 'Feedback comment cannot exceed 500 characters']
    },
    submittedAt: {
      type: Date,
      default: null
    }
  },
  
  // SLA Tracking
  sla: {
    responseTime: {
      type: Number, // in hours
      default: 24
    },
    resolutionTime: {
      type: Number, // in hours
      default: 72
    },
    firstResponseAt: {
      type: Date,
      default: null
    },
    breached: {
      type: Boolean,
      default: false
    }
  },
  
  // Tags for better organization
  tags: [{
    type: String,
    trim: true
  }],
  
  // Escalation
  escalated: {
    type: Boolean,
    default: false
  },
  escalatedAt: {
    type: Date,
    default: null
  },
  escalatedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Virtual for ticket age
ticketSchema.virtual('age').get(function() {
  return Math.floor((Date.now() - this.createdAt) / (1000 * 60 * 60 * 24));
});

// Virtual for days until due
ticketSchema.virtual('daysUntilDue').get(function() {
  if (!this.dueDate) return null;
  const now = new Date();
  const diffTime = this.dueDate - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for overdue status
ticketSchema.virtual('isOverdue').get(function() {
  return this.dueDate && new Date() > this.dueDate && !['resolved', 'closed'].includes(this.status);
});

// Pre-save middleware to generate ticket number
ticketSchema.pre('save', async function(next) {
  if (this.isNew) {
    try {
      const count = await this.constructor.countDocuments();
      const year = new Date().getFullYear();
      this.ticketNumber = `TK-${year}-${String(count + 1).padStart(6, '0')}`;
    } catch (error) {
      console.error('Error generating ticket number:', error);
      // Fallback ticket number
      this.ticketNumber = `TK-${new Date().getFullYear()}-${Date.now()}`;
    }
  }
  next();
});

// Indexes for better performance

ticketSchema.index({ status: 1 });
ticketSchema.index({ priority: 1 });
ticketSchema.index({ category: 1 });
ticketSchema.index({ reportedBy: 1 });
ticketSchema.index({ assignedTo: 1 });
ticketSchema.index({ createdAt: -1 });
ticketSchema.index({ dueDate: 1 });

module.exports = mongoose.model('Ticket', ticketSchema);
