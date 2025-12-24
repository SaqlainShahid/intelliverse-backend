const Ticket = require('../models/Ticket');
const User = require('../models/User');
const Notification = require('../models/Notification');

async function getEscalatedTickets(req, res) {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const filter = { escalated: true };
    if (req.user.role === 'student') {
      filter.reportedBy = req.user._id;
    }
    const tickets = await Ticket.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate('reportedBy', 'profile.firstName profile.lastName email role');

    const total = await Ticket.countDocuments(filter);
    return res.json({
      success: true,
      data: tickets,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        total,
      },
    });
  } catch (err) {
    console.error('List escalated tickets error:', err);
    return res.status(500).json({ success: false, message: 'Failed to list tickets' });
  }
}

async function updateTicketStatus(req, res) {
  try {
    const { ticketId, status = 'resolved', adminReply } = req.body;
    if (!ticketId) {
      return res.status(400).json({ success: false, message: 'ticketId required' });
    }
    const ticket = await Ticket.findById(ticketId);
    if (!ticket) {
      return res.status(404).json({ success: false, message: 'Ticket not found' });
    }
    if (!['admin', 'faculty'].includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    ticket.status = status;
    if (status === 'resolved') {
      ticket.resolvedAt = new Date();
    }
    if (adminReply) {
      ticket.comments.push({
        user: req.user._id,
        message: adminReply,
        isInternal: false,
        createdAt: new Date(),
      });
    }
    await ticket.save();
    await ticket.populate('reportedBy', 'profile.firstName profile.lastName email role');
    await ticket.populate('assignedTo', 'profile.firstName profile.lastName email role');
    await ticket.populate('comments.user', 'profile.firstName profile.lastName email role');
    try {
      const docs = [];
      const title = `Ticket ${ticket.ticketNumber} ${status.replace('_', ' ')}`;
      const prefReporter = await User.findById(ticket.reportedBy).select('preferences.notificationsEnabled').lean();
      if (prefReporter?.preferences?.notificationsEnabled !== false) {
        docs.push({ user: ticket.reportedBy, type: 'helpdesk_status_update', title, message: ticket.title, data: { ticketId: ticket._id, status } });
      }
      if (ticket.assignedTo && ticket.assignedTo.toString() !== ticket.reportedBy.toString()) {
        const prefAssignee = await User.findById(ticket.assignedTo).select('preferences.notificationsEnabled').lean();
        if (prefAssignee?.preferences?.notificationsEnabled !== false) {
          docs.push({ user: ticket.assignedTo, type: 'helpdesk_status_update', title, message: ticket.title, data: { ticketId: ticket._id, status } });
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
    return res.json({ success: true, data: ticket });
  } catch (err) {
    console.error('Update ticket status error:', err);
    return res.status(500).json({ success: false, message: 'Failed to update ticket' });
  }
}

module.exports = { getEscalatedTickets, updateTicketStatus };
