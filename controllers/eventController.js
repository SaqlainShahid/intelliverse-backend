let Event = require('../models/Event');
const Club = require('../models/Club');
const Chat = require('../models/Chat');
const Message = require('../models/Message');
const User = require('../models/User');
const mongoose = require('mongoose');
const Notification = require('../models/Notification');
const crypto = require('crypto');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

try {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
} catch (e) {}

// Ensure Event resolves to a valid Mongoose model in all runtime scenarios
if (!Event || typeof Event.find !== 'function') {
  try {
    Event = mongoose.models.Event || require('../models/Event');
  } catch (e) {
    // Will be surfaced by controller error handling if still undefined
  }
}

const { isCentralApprover } = require('../middleware/auth');

const getEvents = async (req, res) => {
  try {
    const { category, search, status, limit = 10, page = 1, sortBy = 'date' } = req.query;

    let query = {};
    if (category && category !== 'all') query.category = category;
    if (search) {
      query.$or = [
        { title: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    if (status && status !== 'all') query.status = status;

    let sortOption = {};
    switch (sortBy) {
      case 'date': sortOption = { date: 1 }; break;
      case 'popularity': sortOption = { attendeeCount: -1 }; break;
      case 'recent': sortOption = { createdAt: -1 }; break;
      default: sortOption = { date: 1 };
    }

    const approver = req.user && isCentralApprover(req.user);
    if (!approver) {
      query.approvalStatus = 'APPROVED';
    }

    const events = await Event.find(query)
      .populate('organizer', 'name category')
      .populate('createdBy', 'profile.firstName profile.lastName role')
      .sort(sortOption)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const totalEvents = await Event.countDocuments(query);

    res.status(200).json({
      success: true,
      data: events,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalEvents / parseInt(limit)),
        totalEvents,
        hasNext: page * limit < totalEvents,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getPendingEvents = async (req, res) => {
  try {
    const limit = Number.parseInt(req.query.limit, 10) || 20;
    const page = Number.parseInt(req.query.page, 10) || 1;
    const query = { approvalStatus: 'PENDING_APPROVAL' };
    const [events, total] = await Promise.all([
      Event.find(query)
        .select('title date time location category approvalStatus createdAt organizer createdBy')
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip((page - 1) * limit)
        .lean(),
      Event.countDocuments(query)
    ]);
    return res.status(200).json({
      success: true,
      data: events,
      pagination: { total, page }
    });
  } catch (error) {
    console.error('getPendingEvents error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id)
      .populate('organizer', 'name category description contactInfo')
      .populate('createdBy', 'profile.firstName profile.lastName role')
      .populate('attendees.user', 'profile.firstName profile.lastName profile.studentId profile.department')
      .populate('checkIns.user', 'profile.firstName profile.lastName profile.studentId profile.department');

    if (!event) {
      return res.status(404).json({ success: false, message: 'Event not found' });
    }

    const approver = req.user && isCentralApprover(req.user);
    if (!approver && event.approvalStatus !== 'APPROVED') {
      return res.status(403).json({ success: false, message: 'Event not approved yet' });
    }

    let isAttending = false;
    if (req.user) {
      isAttending = event.attendees.some(a => a.user._id.toString() === req.user._id.toString());
    }

    res.status(200).json({
      success: true,
      data: { ...event.toObject(), isAttending, attendeeCount: event.attendees.length }
    });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const createEvent = async (req, res) => {
  try {
    const { title, description, date, time, location, category, maxAttendees, tags, requirements, organizer } = req.body;

    // Basic validation to avoid generic 500s
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, message: 'Title is required' });
    }
    if (!date || isNaN(new Date(date).getTime())) {
      return res.status(400).json({ success: false, message: 'Valid date is required' });
    }
    if (!organizer || !mongoose.Types.ObjectId.isValid(String(organizer))) {
      return res.status(400).json({ success: false, message: 'Organizer (club) is required' });
    }
    const club = await Club.findById(organizer).lean();
    if (!club) {
      return res.status(404).json({ success: false, message: 'Organizer club not found' });
    }
    const canCreate = true;
    if (!canCreate) {
      return res.status(403).json({ success: false, message: 'Not authorized to create event for this club' });
    }

    const approvalStatus = 'PENDING_APPROVAL';
    const toCreate = {
      title,
      description,
      date: new Date(date),
      time,
      location,
      category,
      status: req.body.status || 'upcoming',
      maxAttendees: Number(maxAttendees) || 0,
      tags: Array.isArray(tags) ? tags : (typeof tags === 'string' && tags.length ? tags.split(',').map(t => t.trim()).filter(Boolean) : []),
      requirements: requirements || [],
      createdBy: req.user._id,
      approvalStatus,
      organizer: club._id
    };
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, { folder: 'intelliverse/events', resource_type: 'image' });
        toCreate.imageUrl = result.secure_url;
        toCreate.imagePublicId = result.public_id;
      } finally {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
    }

    const session = await mongoose.startSession();
    let event;
    await session.withTransaction(async () => {
      event = await Event.create([{ ...toCreate }], { session });
      event = event && event[0];
      const groupName = `${club.name} - ${title}`;
      const adminId = club.createdBy?.toString() || req.user._id.toString();
      const participants = [adminId];
      await Chat.create([{ chatType: 'group', name: groupName, description: null, admins: [adminId], participants, category: 'event', club: club._id, event: event._id }], { session });
      await Club.updateOne({ _id: club._id }, { $addToSet: { events: event._id } }, { session });
    });
    await session.endSession();
    const populated = await Event.findById(event._id).populate('organizer', 'name category');
    res.status(201).json({ success: true, message: 'Event created successfully', data: populated });
  } catch (error) {
    console.error('Create event error:', error);
    // Auto-fix legacy qrCode unique index issue and retry once
    if (error && error.code === 11000 && error.keyPattern && error.keyPattern.qrCode) {
      try {
        const db = mongoose.connection.db;
        if (db) {
          const coll = db.collection('events');
          // Drop legacy index and clean nulls
          try { await coll.dropIndex('qrCode_1'); } catch (e) {}
          try { await coll.updateMany({ qrCode: null }, { $unset: { qrCode: "" } }); } catch (e) {}
        }
        // Retry once after cleanup
        const retry = await Event.create({
          title: req.body.title,
          description: req.body.description,
          date: new Date(req.body.date),
          time: req.body.time,
          location: req.body.location,
          category: req.body.category,
          maxAttendees: Number(req.body.maxAttendees) || 0,
          tags: Array.isArray(req.body.tags) ? req.body.tags : (typeof req.body.tags === 'string' && req.body.tags.length ? req.body.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
          requirements: req.body.requirements || [],
          organizer: req.body.organizer,
          createdBy: req.user._id,
          ...(req.file && { image: `/uploads/${req.file.filename}` })
        });
        await retry.populate('organizer', 'name category');
        return res.status(201).json({ success: true, message: 'Event created successfully', data: retry });
      } catch (retryErr) {
        console.error('Create event retry failed:', retryErr);
      }
    }
    // Surface validation errors clearly
    if (error.name === 'ValidationError') {
      const fieldErrors = Object.fromEntries(
        Object.entries(error.errors || {}).map(([k, v]) => [k, v.message])
      );
      return res.status(400).json({ success: false, message: error.message, errors: fieldErrors });
    }
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const updateEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    if (event.approvalStatus !== 'APPROVED') {
      return res.status(400).json({ success: false, message: 'Event not approved' });
    }

    const canUpdate = event.createdBy.toString() === req.user._id.toString() || req.user.role === 'admin' || req.user.role === 'hod';
    if (!canUpdate) return res.status(403).json({ success: false, message: 'Not authorized to update this event' });

    const updateData = { ...req.body };
    if (updateData.date) updateData.date = new Date(updateData.date);
    if (typeof updateData.tags === 'string') {
      updateData.tags = updateData.tags.split(',').map(t => t.trim()).filter(Boolean);
    }
    if (req.file) {
      try {
        const result = await cloudinary.uploader.upload(req.file.path, { folder: 'intelliverse/events', resource_type: 'image' });
        updateData.imageUrl = result.secure_url;
        updateData.imagePublicId = result.public_id;
        if (event.imagePublicId) {
          try { await cloudinary.uploader.destroy(event.imagePublicId); } catch (e) {}
        }
      } finally {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
    }

    const wasCompleted = event.status === 'completed';
    const updatedEvent = await Event.findByIdAndUpdate(req.params.id, updateData, { new: true, runValidators: true })
      .populate('organizer', 'name category');

    if (!wasCompleted && updatedEvent.status === 'completed') {
      try {
        const attendeeIds = event.attendees.map(a => a.user);
        for (const uid of attendeeIds) {
          await Notification.create({
            user: uid,
            type: 'event_feedback_request',
            title: 'Event feedback requested',
            message: 'Please share your feedback for the event you attended',
            data: { eventId: event._id }
          });
        }
      } catch (e) {}
    }

    res.status(200).json({ success: true, message: 'Event updated successfully', data: updatedEvent });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const deleteEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

  const canDelete = 
    event.createdBy.toString() === req.user._id.toString() ||
    req.user.role === 'admin' ||
    req.user.role === 'hod' ||
    req.user.isEventClubManager;
  if (!canDelete) return res.status(403).json({ success: false, message: 'Not authorized to delete this event' });

  await Event.findByIdAndDelete(req.params.id);
  await User.updateMany({ joinedEvents: req.params.id }, { $pull: { joinedEvents: req.params.id } });
  try {
    const chat = await Chat.findOne({ event: event._id }).select('_id').lean();
    if (chat) {
      await Message.deleteMany({ chat: chat._id });
      await Chat.deleteOne({ _id: chat._id });
    }
  } catch {}

  res.status(200).json({ success: true, message: 'Event deleted successfully' });
  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const joinEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    const isAlreadyAttending = event.attendees.some(a => a.user.toString() === req.user._id.toString());
    if (isAlreadyAttending) {
      return res.status(200).json({ success: true, message: 'Already joined', data: { alreadyJoined: true } });
    }

    if (event.maxAttendees && event.attendees.length >= event.maxAttendees) {
      const alreadyWaitlisted = event.waitlist?.some(w => w.user.toString() === req.user._id.toString());
      if (alreadyWaitlisted) {
        return res.status(200).json({ success: true, message: 'Already waitlisted', data: { waitlisted: true } });
      }
      event.waitlist = event.waitlist || [];
      event.waitlist.push({ user: req.user._id, addedAt: new Date() });
      await event.save();
      return res.status(200).json({ success: true, message: 'Added to waitlist', data: { waitlisted: true } });
    }

    event.attendees.push({ user: req.user._id, joinedAt: new Date() });
    await event.save();
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { joinedEvents: req.params.id } });
    try {
      const club = event.organizer ? await Club.findById(event.organizer) : null;
      const isClubMember = club ? club.members.some(m => m.user.toString() === req.user._id.toString()) : false;
      if (isClubMember) {
        await Chat.updateOne({ event: event._id }, { $addToSet: { participants: req.user._id } });
        const chat = await Chat.findOne({ event: event._id }).select('_id').lean();
        if (chat) {
          await User.updateOne({ _id: req.user._id }, { $pull: { deletedChats: chat._id } });
        }
      }
    } catch {}

    res.status(200).json({ success: true, message: 'Successfully joined the event' });
  } catch (error) {
    console.error('Join event error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const leaveEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });

    const attendeeIndex = event.attendees.findIndex(a => a.user.toString() === req.user._id.toString());
    if (attendeeIndex === -1) return res.status(400).json({ success: false, message: 'You are not registered for this event' });

    event.attendees.splice(attendeeIndex, 1);
    const canPromote = event.maxAttendees ? event.attendees.length < event.maxAttendees : false;
    if (canPromote && Array.isArray(event.waitlist) && event.waitlist.length > 0) {
      const next = event.waitlist.shift();
      if (next && next.user) {
        event.attendees.push({ user: next.user, joinedAt: new Date() });
        try {
          await Notification.create({
            user: next.user,
            type: 'event_waitlist_promoted',
            title: 'You got a spot',
            message: 'A spot opened up and you have been moved from the waitlist to attendees',
            data: { eventId: event._id }
          });
        } catch (e) {}
        await User.findByIdAndUpdate(next.user, { $addToSet: { joinedEvents: event._id } });
      }
    }
    await event.save();
    await User.findByIdAndUpdate(req.user._id, { $pull: { joinedEvents: req.params.id } });
    try {
      await Chat.updateOne({ event: event._id }, { $pull: { participants: req.user._id, admins: req.user._id } });
    } catch {}

    res.status(200).json({ success: true, message: 'Successfully left the event' });
  } catch (error) {
    console.error('Leave event error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getEventCategories = async (req, res) => {
  try {
    const categories = await Event.distinct('category');
    res.status(200).json({ success: true, data: categories.filter(Boolean) });
  } catch (error) {
    console.error('Get event categories error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports = { getEvents, getEvent, createEvent, updateEvent, deleteEvent, joinEvent, leaveEvent, getEventCategories };

const generateEventQr = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const canManage = event.createdBy.toString() === req.user._id.toString() || req.user.role === 'admin' || req.user.role === 'hod';
    if (!canManage) return res.status(403).json({ success: false, message: 'Not authorized' });
    const minutes = parseInt(req.body.expiresInMinutes || 120);
    const code = crypto.randomBytes(16).toString('hex');
    event.qrCode = code;
    event.qrCodeExpires = new Date(Date.now() + minutes * 60000);
    await event.save();
    res.status(200).json({ success: true, data: { qrCode: code, expiresAt: event.qrCodeExpires } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const checkInEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const code = String(req.body.code || '').trim();
    if (!code || !event.qrCode || code !== event.qrCode) {
      return res.status(400).json({ success: false, message: 'Invalid QR code' });
    }
    if (event.qrCodeExpires && event.qrCodeExpires.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'QR code expired' });
    }
    const alreadyAttendee = event.attendees.some(a => a.user.toString() === req.user._id.toString());
    if (!alreadyAttendee) {
      if (event.maxAttendees && event.attendees.length >= event.maxAttendees) {
        return res.status(400).json({ success: false, message: 'Event is full' });
      }
      event.attendees.push({ user: req.user._id, joinedAt: new Date() });
      await User.findByIdAndUpdate(req.user._id, { $addToSet: { joinedEvents: event._id } });
    }
    const hasCheckedIn = event.checkIns.some(ci => ci.user.toString() === req.user._id.toString());
    if (!hasCheckedIn) {
      event.checkIns.push({ user: req.user._id, checkedAt: new Date(), method: 'qr' });
      event.checkInCount = event.checkIns.length;
    }
    await event.save();
    try {
      await Notification.create({
        user: req.user._id,
        type: 'event_checkin',
        title: 'Check-in confirmed',
        message: 'Your event check-in has been recorded',
        data: { eventId: event._id }
      });
    } catch (e) {}
    res.status(200).json({ success: true, message: 'Checked in successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const submitEventFeedback = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const isAttendee = event.attendees.some(a => a.user.toString() === req.user._id.toString());
    if (!isAttendee) return res.status(403).json({ success: false, message: 'Only attendees can submit feedback' });
    const rating = parseInt(req.body.rating);
    const comment = typeof req.body.comment === 'string' ? req.body.comment : '';
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }
    const existing = event.feedbacks.find(f => f.user.toString() === req.user._id.toString());
    if (existing) {
      existing.rating = rating;
      existing.comment = comment;
      existing.submittedAt = new Date();
    } else {
      event.feedbacks.push({ user: req.user._id, rating, comment, submittedAt: new Date() });
    }
    await event.save();
    res.status(200).json({ success: true, message: 'Feedback submitted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const getEventFeedback = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const canView = event.createdBy.toString() === req.user._id.toString() || req.user.role === 'admin' || req.user.role === 'hod';
    if (!canView) return res.status(403).json({ success: false, message: 'Not authorized' });
    const total = event.feedbacks.length;
    const sum = event.feedbacks.reduce((acc, f) => acc + (f.rating || 0), 0);
    const avg = total ? sum / total : 0;
    const dist = [0,0,0,0,0];
    for (const f of event.feedbacks) {
      if (f.rating >= 1 && f.rating <= 5) dist[f.rating - 1] += 1;
    }
    res.status(200).json({ success: true, data: { total, average: avg, distribution: dist, feedbacks: event.feedbacks } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

const sendUpcomingReminders = async (req, res) => {
  try {
    const now = Date.now();
    const in24h = new Date(now + 24 * 60 * 60 * 1000);
    const events = await Event.find({ status: 'upcoming', date: { $lte: in24h, $gte: new Date(now) }, reminderSentFor24h: false });
    let sent = 0;
    for (const ev of events) {
      for (const a of ev.attendees) {
        await Notification.create({
          user: a.user,
          type: 'event_reminder',
          title: 'Event starts soon',
          message: 'An event you registered for is starting within 24 hours',
          data: { eventId: ev._id, date: ev.date, title: ev.title }
        });
        sent += 1;
      }
      ev.reminderSentFor24h = true;
      await ev.save();
    }
    res.status(200).json({ success: true, data: { remindersSent: sent, eventsProcessed: events.length } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports.generateEventQr = generateEventQr;
module.exports.checkInEvent = checkInEvent;
module.exports.submitEventFeedback = submitEventFeedback;
module.exports.getEventFeedback = getEventFeedback;
module.exports.sendUpcomingReminders = sendUpcomingReminders;

const resolveEventByCode = async (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    if (!code) return res.status(400).json({ success: false, message: 'code is required' });
    const event = await Event.findOne({ qrCode: code })
      .populate('organizer', 'name category')
      .populate('createdBy', 'profile.firstName profile.lastName role');
    if (!event) return res.status(404).json({ success: false, message: 'Not found' });
    res.status(200).json({ success: true, data: event });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports.resolveEventByCode = resolveEventByCode;

const getEventIcs = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const escape = (s) => String(s || '').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
    const toUtc = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
    };
    const parseTime = (t) => {
      if (!t || typeof t !== 'string') return null;
      const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (!m) return null;
      let h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const ap = m[3] ? m[3].toUpperCase() : null;
      if (ap === 'PM' && h < 12) h += 12;
      if (ap === 'AM' && h === 12) h = 0;
      return { h, min };
    };
    const start = new Date(event.date);
    const parsed = parseTime(event.time);
    if (parsed) {
      start.setHours(parsed.h, parsed.min, 0, 0);
    }
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    const ics =
`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//IntelliVerse//Event//EN
BEGIN:VEVENT
UID:${event._id}@intelliverse
DTSTAMP:${toUtc(new Date())}
DTSTART:${toUtc(start)}
DTEND:${toUtc(end)}
SUMMARY:${escape(event.title)}
DESCRIPTION:${escape(event.description)}
LOCATION:${escape(event.location)}
END:VEVENT
END:VCALENDAR`;
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="event-${event._id}.ics"`);
    res.status(200).send(ics);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports.getEventIcs = getEventIcs;

const downloadAttendeesCsv = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id).populate('attendees.user', 'profile.firstName profile.lastName profile.studentId profile.department email');
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const canExport = event.createdBy.toString() === req.user._id.toString() || req.user.role === 'admin' || req.user.role === 'hod';
    if (!canExport) return res.status(403).json({ success: false, message: 'Not authorized' });
    const rows = [['Student ID','First Name','Last Name','Department','Email','Joined At']];
    for (const a of event.attendees) {
      const u = a.user || {};
      rows.push([
        u?.profile?.studentId || '',
        u?.profile?.firstName || '',
        u?.profile?.lastName || '',
        u?.profile?.department || '',
        u?.email || '',
        a.joinedAt ? new Date(a.joinedAt).toISOString() : ''
      ]);
    }
    const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\r\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="event-${event._id}-attendees.csv"`);
    res.status(200).send(csv);
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports.downloadAttendeesCsv = downloadAttendeesCsv;

const announceEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const canAnnounce = event.createdBy.toString() === req.user._id.toString() || req.user.role === 'admin' || req.user.role === 'faculty' || req.user.role === 'hod';
    if (!canAnnounce) return res.status(403).json({ success: false, message: 'Not authorized' });
    const title = String(req.body.title || '').trim() || 'Event Announcement';
    const message = String(req.body.message || '').trim() || '';
    let sent = 0;
    for (const a of event.attendees) {
      try {
        await Notification.create({
          user: a.user,
          type: 'event_announcement',
          title,
          message,
          data: { eventId: event._id }
        });
        sent += 1;
      } catch (e) {}
    }
    res.status(200).json({ success: true, data: { sent } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports.announceEvent = announceEvent;
const approveEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    event.approvalStatus = 'APPROVED';
    event.approvedBy = req.user._id;
    event.approvedAt = new Date();
    event.rejectionReason = null;
    await event.save();
    try {
      if (event.createdBy) {
        await Notification.create({
          user: event.createdBy,
          type: 'event_approval',
          title: 'Event approved',
          message: `Your event "${event.title}" has been approved`,
          data: { eventId: event._id, status: event.approvalStatus }
        });
      }
    } catch (e) {}
    return res.json({ success: true, message: 'Event approved' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

const rejectEvent = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return res.status(404).json({ success: false, message: 'Event not found' });
    const reason = String(req.body.reason || '').trim() || null;
    try {
      if (event.createdBy) {
        await Notification.create({
          user: event.createdBy,
          type: 'event_approval',
          title: 'Event rejected',
          message: reason
            ? `Your event "${event.title}" was rejected and removed: ${reason}`
            : `Your event "${event.title}" was rejected and removed`,
          data: { eventId: event._id, status: 'REJECTED' }
        });
      }
    } catch (e) {}
    try {
      await Event.findByIdAndDelete(event._id);
      await User.updateMany({ joinedEvents: event._id }, { $pull: { joinedEvents: event._id } });
      try {
        const chat = await Chat.findOne({ event: event._id }).select('_id').lean();
        if (chat) {
          await Message.deleteMany({ chat: chat._id });
          await Chat.deleteOne({ _id: chat._id });
        }
      } catch {}
    } catch (cleanupErr) {
      console.warn('Reject event cleanup failed:', cleanupErr.message);
    }
    return res.json({ success: true, message: 'Event rejected and deleted' });
  } catch (e) {
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

module.exports.approveEvent = approveEvent;
module.exports.rejectEvent = rejectEvent;
module.exports.getPendingEvents = getPendingEvents;
