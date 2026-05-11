const Ticket = require('../models/Ticket');
const User = require('../models/User');
const Notification = require('../models/Notification');
const { sendTicketNotification } = require('../utils/emailService');
const path = require('path');
const fs = require('fs');

// Get all tickets with filtering, sorting, and pagination
const getAllTickets = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      priority,
      category,
      assignedTo,
      reportedBy,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    // Build filter object
    const filter = {};
    
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (category) filter.category = category;
    if (assignedTo) filter.assignedTo = assignedTo;
    if (reportedBy) filter.reportedBy = reportedBy;
    
    // Search functionality
    if (search) {
      filter.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { ticketNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Role-based filtering
    if (req.user.role === 'student') {
      filter.reportedBy = req.user._id;
    }

    // Calculate pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build sort object
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Execute query
    const tickets = await Ticket.find(filter)
      .populate('reportedBy', 'profile.firstName profile.lastName email role')
      .populate('assignedTo', 'profile.firstName profile.lastName email role')
      .sort(sort)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Ticket.countDocuments(filter);

    res.json({
      success: true,
      data: {
        tickets,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalTickets: total,
          hasNext: skip + tickets.length < total,
          hasPrev: parseInt(page) > 1
        }
      }
    });
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch tickets',
      error: error.message
    });
  }
};

// Get single ticket by ID
const getTicketById = async (req, res) => {
  try {
    const ticket = await Ticket.findById(req.params.id)
      .populate('reportedBy', 'profile.firstName profile.lastName email role department')
      .populate('assignedTo', 'profile.firstName profile.lastName email role')
      .populate('comments.user', 'profile.firstName profile.lastName email role');

    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Check permissions
    if (req.user.role !== 'admin' && 
        req.user.role !== 'faculty' && 
        ticket.reportedBy._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: ticket
    });
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket',
      error: error.message
    });
  }
};

// Create new ticket
const createTicket = async (req, res) => {
  try {
    console.log('Create ticket request body:', req.body);
    console.log('User from request:', req.user);
    
    const {
      title,
      description,
      category,
      subcategory,
      priority = 'medium',
      department,
      tags = []
    } = req.body;

    // Validate required fields
    if (!title || !description || !category || !department) {
      return res.status(400).json({
        success: false,
        message: 'Title, description, category, and department are required'
      });
    }

    // Check if user is authenticated
    if (!req.user || !req.user._id) {
      return res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
    }

    const isAtt = (category === 'academic' && subcategory?.toLowerCase().includes('attendance')) || 
                  title.toLowerCase().includes('attendance') || 
                  (tags && tags.some(t => t.toLowerCase().includes('attendance')));

    // Create ticket
    const ticket = new Ticket({
      title,
      description,
      category,
      subcategory,
      priority,
      department,
      reportedBy: req.user._id,
      tags,
      // Logic for multi-stage approval (Attendance Issues)
      isAttendanceIssue: isAtt,
      status: isAtt ? 'pending_teacher' : 'open'
    });

    await ticket.save();

    await ticket.populate('reportedBy', 'profile.firstName profile.lastName email role');

    try {
      await sendTicketNotification('new_ticket', ticket);
    } catch (emailError) {
      console.error('Email notification failed:', emailError);
    }
    try {
      const admins = await User.find({ role: 'admin', isActive: true }).select('_id preferences.notificationsEnabled').lean();
      const docs = [];
      const title = `New ticket: ${ticket.title}`;
      const msg = ticket.description || null;
      for (const a of admins) {
        if (a.preferences?.notificationsEnabled !== false) {
          docs.push({ user: a._id, type: 'helpdesk_new_ticket', title, message: msg, data: { ticketId: ticket._id, department: ticket.department, priority: ticket.priority } });
        }
      }
      const pref = await User.findById(ticket.reportedBy._id).select('preferences.notificationsEnabled').lean();
      if (pref?.preferences?.notificationsEnabled !== false) {
        docs.push({ user: ticket.reportedBy._id, type: 'helpdesk_new_ticket', title: 'Ticket submitted', message: ticket.title, data: { ticketId: ticket._id } });
      }
      if (docs.length) {
        const created = await Notification.insertMany(docs);
        if (global.io) {
          for (const n of created) {
            global.io.to(n.user.toString()).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
          }
        }
      }
    } catch {}

    res.status(201).json({
      success: true,
      message: 'Ticket created successfully',
      data: ticket
    });
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create ticket',
      error: error.message
    });
  }
};

// Update ticket
const updateTicket = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Check permissions
    const canUpdate = req.user.role === 'admin' || 
                     req.user.role === 'faculty' || 
                     req.user.role === 'hod' ||
                     ticket.reportedBy.toString() === req.user._id.toString();

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Update fields
    const allowedUpdates = ['title', 'description', 'priority', 'status', 'assignedTo', 'tags', 'escalated', 'escalatedTo', 'dueDate'];
    const filteredUpdates = {};
    
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        filteredUpdates[key] = updates[key];
      }
    });

    // Handle status changes & Multi-stage Approval transitions
    if (updates.status) {
      // If it's an attendance issue, handle transitions & enforce hierarchy
      if (ticket.isAttendanceIssue) {
        const userDesignation = req.user.profile?.designation?.toLowerCase() || '';
        const teachingKeywords = ['teacher', 'lecturer', 'leacturer', 'professor', 'prof', 'instructor', 'visiting', 'lab engineer'];
        const isTeachingRole = teachingKeywords.some(keyword => userDesignation.includes(keyword));

        // Guard: Prevent skipping stages or resolving prematurely
        if (updates.status === 'pending_faculty') {
          if (ticket.status !== 'pending_teacher') {
            return res.status(403).json({ success: false, message: 'Teacher must approve before Faculty Overseer stage' });
          }
          // Enforce Teaching role for the first stage
          if (!isTeachingRole || userDesignation.includes('coordinator')) {
            return res.status(403).json({ success: false, message: 'Only a Teaching Role (Teacher, Lecturer, Professor) can approve this stage, not a Coordinator.' });
          }
        }
        
        if (updates.status === 'pending_hod') {
          if (ticket.status !== 'pending_faculty') {
            return res.status(403).json({ success: false, message: 'Faculty Overseer must approve before HOD stage' });
          }
          // Enforce Coordinator role for the Overseer stage
          if (!userDesignation.includes('coordinator') && req.user.role !== 'admin' && req.user.role !== 'hod') {
            return res.status(403).json({ success: false, message: 'Only a Faculty Coordinator can approve the Overseer stage.' });
          }
        }
        
        if (updates.status === 'resolved') {
          if (ticket.status !== 'pending_hod') {
            return res.status(403).json({ success: false, message: 'HOD must give final review before resolving attendance issues' });
          }
          // Enforce HOD role for final stage
          if (req.user.role !== 'hod' && req.user.role !== 'admin' && !userDesignation.includes('hod') && !userDesignation.includes('head')) {
            return res.status(403).json({ success: false, message: 'Only an HOD can resolve the final stage of an attendance issue.' });
          }
        }

        // Apply approvals if valid
        if (updates.status === 'pending_faculty' && ticket.status === 'pending_teacher') {
          filteredUpdates.approvalChain = { 
            ...ticket.approvalChain, 
            teacherApproval: { status: 'approved', approvedBy: req.user._id, approvedAt: new Date(), remarks: updates.remarks || 'Approved by Teacher' }
          };
        } else if (updates.status === 'pending_hod' && ticket.status === 'pending_faculty') {
          filteredUpdates.approvalChain = { 
            ...ticket.approvalChain, 
            facultyApproval: { status: 'approved', approvedBy: req.user._id, approvedAt: new Date(), remarks: updates.remarks || 'Approved by Faculty Overseer' }
          };
        } else if (updates.status === 'resolved' && ticket.status === 'pending_hod') {
          filteredUpdates.approvalChain = { 
            ...ticket.approvalChain, 
            hodApproval: { status: 'approved', approvedBy: req.user._id, approvedAt: new Date(), remarks: updates.remarks || 'Final Approval by HOD' }
          };
          filteredUpdates.resolvedAt = new Date();
        }
      } else {
        // Standard non-attendance ticket transitions
        if (updates.status === 'resolved') {
          filteredUpdates.resolvedAt = new Date();
        } else if (updates.status === 'closed') {
          filteredUpdates.closedAt = new Date();
        }
      }
    }

    const updatedTicket = await Ticket.findByIdAndUpdate(
      id,
      filteredUpdates,
      { new: true, runValidators: true }
    ).populate('reportedBy', 'profile.firstName profile.lastName email role')
     .populate('assignedTo', 'profile.firstName profile.lastName email role');

    if (updates.status && updates.status !== ticket.status) {
      try {
        await sendTicketNotification('status_update', updatedTicket);
      } catch (emailError) {
        console.error('Email notification failed:', emailError);
      }
      try {
        const docs = [];
        const title = `Ticket ${updatedTicket.ticketNumber} ${updates.status.replace('_', ' ')}`;
        const prefReporter = await User.findById(updatedTicket.reportedBy._id).select('preferences.notificationsEnabled').lean();
        if (prefReporter?.preferences?.notificationsEnabled !== false) {
          docs.push({ user: updatedTicket.reportedBy._id, type: 'helpdesk_status_update', title, message: updatedTicket.title, data: { ticketId: updatedTicket._id, status: updates.status } });
        }
        if (updatedTicket.assignedTo && updatedTicket.assignedTo._id && updatedTicket.assignedTo._id.toString() !== updatedTicket.reportedBy._id.toString()) {
          const prefAssignee = await User.findById(updatedTicket.assignedTo._id).select('preferences.notificationsEnabled').lean();
          if (prefAssignee?.preferences?.notificationsEnabled !== false) {
            docs.push({ user: updatedTicket.assignedTo._id, type: 'helpdesk_status_update', title, message: updatedTicket.title, data: { ticketId: updatedTicket._id, status: updates.status } });
          }
        }
        if (docs.length) {
          const created = await Notification.insertMany(docs);
          if (global.io) {
            for (const n of created) {
              global.io.to(n.user.toString()).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
            }
          }
        }
      } catch {}
    }

    res.json({
      success: true,
      message: 'Ticket updated successfully',
      data: updatedTicket
    });
  } catch (error) {
    console.error('Error updating ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update ticket',
      error: error.message
    });
  }
};

// Add comment to ticket
const addComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { message, isInternal = false } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Comment message is required'
      });
    }

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Check permissions
    const canComment = req.user.role === 'admin' || 
                      req.user.role === 'faculty' || 
                      ticket.reportedBy.toString() === req.user._id.toString();

    if (!canComment) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Add comment
    ticket.comments.push({
      user: req.user._id,
      message,
      isInternal: req.user.role === 'admin' || req.user.role === 'faculty' ? isInternal : false
    });

    // Update first response time if this is the first staff response
    if (!ticket.sla.firstResponseAt && (req.user.role === 'admin' || req.user.role === 'faculty')) {
      ticket.sla.firstResponseAt = new Date();
    }

    await ticket.save();

    await ticket.populate('comments.user', 'profile.firstName profile.lastName email role');
    await ticket.populate('reportedBy', 'profile.firstName profile.lastName email role');
    await ticket.populate('assignedTo', 'profile.firstName profile.lastName email role');

    try {
      await sendTicketNotification('new_comment', ticket);
    } catch (emailError) {
      console.error('Email notification failed:', emailError);
    }
    try {
      const last = ticket.comments[ticket.comments.length - 1];
      const actorId = last.user.toString();
      const actorIsStaff = ['admin', 'faculty'].includes(req.user.role);
      const targets = [];
      if (actorIsStaff) {
        if (ticket.reportedBy && ticket.reportedBy.toString() !== actorId) targets.push(ticket.reportedBy);
      } else {
        if (ticket.assignedTo) {
          targets.push(ticket.assignedTo);
        } else {
          const admins = await User.find({ role: 'admin', isActive: true }).select('_id').lean();
          for (const a of admins) targets.push(a._id);
        }
      }
      const docs = [];
      const cm = last.message || null;
      for (const uid of targets) {
        const pref = await User.findById(uid).select('preferences.notificationsEnabled').lean();
        if (pref?.preferences?.notificationsEnabled !== false) {
          docs.push({ user: uid, type: 'helpdesk_comment', title: 'New ticket comment', message: cm, data: { ticketId: ticket._id } });
        }
      }
      if (docs.length) {
        const created = await Notification.insertMany(docs);
        if (global.io) {
          for (const n of created) {
            global.io.to(n.user.toString()).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
          }
        }
      }
    } catch {}

    res.json({
      success: true,
      message: 'Comment added successfully',
      data: ticket
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add comment',
      error: error.message
    });
  }
};

// Submit feedback
const submitFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, comment } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Valid rating (1-5) is required'
      });
    }

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Check if user can submit feedback
    if (ticket.reportedBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the ticket reporter can submit feedback'
      });
    }

    // Check if ticket is resolved/closed
    if (!['resolved', 'closed'].includes(ticket.status)) {
      return res.status(400).json({
        success: false,
        message: 'Feedback can only be submitted for resolved or closed tickets'
      });
    }

    // Update feedback
    ticket.feedback = {
      rating,
      comment,
      submittedAt: new Date()
    };

    await ticket.save();

    res.json({
      success: true,
      message: 'Feedback submitted successfully',
      data: ticket
    });
  } catch (error) {
    console.error('Error submitting feedback:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to submit feedback',
      error: error.message
    });
  }
};

// Get ticket statistics
const getTicketStats = async (req, res) => {
  try {
    const stats = await Ticket.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          open: { $sum: { $cond: [{ $eq: ['$status', 'open'] }, 1, 0] } },
          inProgress: { $sum: { $cond: [{ $eq: ['$status', 'in_progress'] }, 1, 0] } },
          resolved: { $sum: { $cond: [{ $eq: ['$status', 'resolved'] }, 1, 0] } },
          closed: { $sum: { $cond: [{ $eq: ['$status', 'closed'] }, 1, 0] } },
          urgent: { $sum: { $cond: [{ $eq: ['$priority', 'urgent'] }, 1, 0] } },
          high: { $sum: { $cond: [{ $eq: ['$priority', 'high'] }, 1, 0] } },
          overdue: { 
            $sum: { 
              $cond: [
                { 
                  $and: [
                    { $lt: ['$dueDate', new Date()] }, 
                    { $not: { $in: ['$status', ['resolved', 'closed']] } }
                  ] 
                }, 
                1, 
                0
              ] 
            } 
          }
        }
      }
    ]);

    const categoryStats = await Ticket.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const avgResolutionTime = await Ticket.aggregate([
      {
        $match: {
          status: { $in: ['resolved', 'closed'] },
          resolvedAt: { $exists: true }
        }
      },
      {
        $group: {
          _id: null,
          avgTime: {
            $avg: {
              $divide: [
                { $subtract: ['$resolvedAt', '$createdAt'] },
                1000 * 60 * 60 * 24 // Convert to days
              ]
            }
          }
        }
      }
    ]);

    res.json({
      success: true,
      data: {
        overview: stats[0] || {
          total: 0,
          open: 0,
          inProgress: 0,
          resolved: 0,
          closed: 0,
          urgent: 0,
          high: 0,
          overdue: 0
        },
        categoryStats,
        avgResolutionTime: avgResolutionTime[0]?.avgTime || 0
      }
    });
  } catch (error) {
    console.error('Error fetching ticket stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch ticket statistics',
      error: error.message
    });
  }
};

// Delete ticket (admin only)
const deleteTicket = async (req, res) => {
  try {
    const { id } = req.params;

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Only admin can delete tickets
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only administrators can delete tickets'
      });
    }

    // Delete attachments if any
    if (ticket.attachments && ticket.attachments.length > 0) {
      ticket.attachments.forEach(attachment => {
        const filePath = path.join(__dirname, '../uploads', attachment.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      });
    }

    await Ticket.findByIdAndDelete(id);

    res.json({
      success: true,
      message: 'Ticket deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting ticket:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete ticket',
      error: error.message
    });
  }
};

// Upload file attachment
const uploadAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Check permissions
    const canUpload = req.user.role === 'admin' || 
                     req.user.role === 'faculty' || 
                     ticket.reportedBy.toString() === req.user._id.toString();

    if (!canUpload) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    // Add attachment to ticket
    ticket.attachments.push({
      filename: req.file.filename,
      originalName: req.file.originalname,
      path: req.file.path,
      size: req.file.size
    });

    await ticket.save();

    res.json({
      success: true,
      message: 'File uploaded successfully',
      data: {
        filename: req.file.filename,
        originalName: req.file.originalname,
        size: req.file.size
      }
    });
  } catch (error) {
    console.error('Error uploading attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload file',
      error: error.message
    });
  }
};

// Download file attachment
const downloadAttachment = async (req, res) => {
  try {
    const { id, filename } = req.params;

    const ticket = await Ticket.findById(id);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        message: 'Ticket not found'
      });
    }

    // Check permissions
    const canDownload = req.user.role === 'admin' || 
                       req.user.role === 'faculty' || 
                       ticket.reportedBy.toString() === req.user._id.toString();

    if (!canDownload) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }

    const attachment = ticket.attachments.find(att => att.filename === filename);
    if (!attachment) {
      return res.status(404).json({
        success: false,
        message: 'Attachment not found'
      });
    }

    const filePath = path.join(__dirname, '../uploads', attachment.filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    res.download(filePath, attachment.originalName);
  } catch (error) {
    console.error('Error downloading attachment:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to download file',
      error: error.message
    });
  }
};

module.exports = {
  getAllTickets,
  getTicketById,
  createTicket,
  updateTicket,
  addComment,
  submitFeedback,
  getTicketStats,
  deleteTicket,
  uploadAttachment,
  downloadAttachment
};
