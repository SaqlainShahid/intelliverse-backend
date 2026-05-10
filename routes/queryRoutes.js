const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const { authenticate, authorize } = require('../middleware/auth');
const Query = require('../models/Query');
const Department = require('../models/Department');
const Ticket = require('../models/Ticket');
const { classifyAndAnswer } = require('../services/aiService');

const ALLOWED_QUERY_TAGS = new Set(['IT', 'Finance', 'Exams', 'Admissions', 'Hostel', 'Library', 'Career', 'Other']);

const resolveDepartment = async (department) => {
  if (!department) return null;
  if (mongoose.Types.ObjectId.isValid(department)) {
    return Department.findById(department);
  }
  if (ALLOWED_QUERY_TAGS.has(department)) {
    return Department.findOne({ name: department });
  }
  return Department.findOne({ name: department });
};

const resolveUserDepartment = async (user) => {
  try {
    const name = user?.profile?.department;
    if (!name) return null;
    return await Department.findOne({ name: name });
  } catch { return null; }
};

// 1. POST /api/ai/query - Main Chat Interface
router.post('/query', authenticate, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ success: false, message: 'Message is required' });

    // 1. AI Processing
    const aiResult = await classifyAndAnswer(message);
    const { intent, answer, confidence } = aiResult;
    const rawTag = aiResult?.tag;
    const tag = ALLOWED_QUERY_TAGS.has(rawTag) ? rawTag : 'Other';

    // 2. Check if we have a department for this tag
    let department = await Department.findOne({ name: tag });
    if (!department && tag !== 'Other') department = await Department.findOne({ name: 'Other' });
    // If no department found (or tag is Other), maybe assign to a default or keep null
    
    const normalizedAnswer = typeof answer === 'string' ? answer.trim() : '';
    const shouldAutoAnswer = Boolean(normalizedAnswer);

    // 3. Create Query Record
    const query = new Query({
      userId: req.user._id,
      message,
      tag: tag || 'Other',
      department: department ? department._id : null,
      originDepartment: department ? department._id : null,
      collaboratingDepartments: [],
      status: shouldAutoAnswer ? 'answered' : 'pending',
      aiConfidence: confidence,
      aiResponse: normalizedAnswer || null,
      history: [{
        sender: req.user._id,
        message: message
      }]
    });

    // If AI answered it confidently
    if (shouldAutoAnswer) {
      query.history.push({
        sender: null, // System/AI
        message: normalizedAnswer
      });
      query.resolution = 'Answered by AI';
    }

    await query.save();

    // 4. Notify Department Admins (Socket.IO)
    // Notify if NOT auto-answered (so pending queries, even with low-confidence suggestions, get routed)
    if (!shouldAutoAnswer && department && global.io) {
      // Notify admins of this department
      // Assuming admins are joined to a room `dept_${department._id}` or we emit to specific users
      if (department.admins && department.admins.length > 0) {
        department.admins.forEach(adminId => {
           global.io.to(adminId.toString()).emit('query:new', query);
        });
      }
    }

    return res.json({
      success: true,
      data: {
        queryId: query._id,
        answer: shouldAutoAnswer ? normalizedAnswer : null,
        tag,
        status: query.status
      }
    });

  } catch (error) {
    console.error('Query Error:', error);
    return res.status(500).json({ success: false, message: 'Failed to process query' });
  }
});

// 2. GET /api/ai/queries - Admin Dashboard (List by Dept)
router.get('/queries', authenticate, authorize('admin', 'faculty', 'hod'), async (req, res) => {
  try {
    const { department, status } = req.query;
    const filter = {};

    // If admin, filter by their department permissions (logic depends on how we assign admins)
    // For now, assuming "admin" role sees all, or filter by param
    if (department) {
        const d = await resolveDepartment(department);
        if (d?._id) {
          filter.$or = [{ department: d._id }, { collaboratingDepartments: d._id }];
        } else if (ALLOWED_QUERY_TAGS.has(department)) {
          filter.tag = department;
        }
    }

    if (status) filter.status = status;
    else filter.status = 'pending';

    const queries = await Query.find(filter)
      .populate('userId', 'profile.firstName profile.lastName email')
      .populate('department')
      .populate('originDepartment')
      .populate('collaboratingDepartments')
      .populate({ path: 'transfers.fromDepartment', select: 'name' })
      .populate({ path: 'transfers.toDepartment', select: 'name' })
      .populate({ path: 'transfers.by', select: 'profile.firstName profile.lastName email' })
      .populate({ path: 'collaboratorStatuses.department', select: 'name' })
      .sort({ createdAt: -1 });

    return res.json({ success: true, data: queries });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch queries' });
  }
});

// 3. GET /api/ai/my-queries - Student History
router.get('/my-queries', authenticate, async (req, res) => {
  try {
    const queries = await Query.find({ userId: req.user._id })
      .populate('department', 'name')
      .populate('originDepartment', 'name')
      .populate('collaboratingDepartments', 'name')
      .populate({ path: 'transfers.fromDepartment', select: 'name' })
      .populate({ path: 'transfers.toDepartment', select: 'name' })
      .populate({ path: 'transfers.by', select: 'profile.firstName profile.lastName email' })
      .populate({ path: 'collaboratorStatuses.department', select: 'name' })
      .sort({ createdAt: -1 });
    return res.json({ success: true, data: queries });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch history' });
  }
});

// 4. PATCH /api/ai/queries/:id/reply - Admin Reply
router.patch('/queries/:id/reply', authenticate, authorize('admin', 'faculty', 'hod'), async (req, res) => {
  try {
    const { id } = req.params;
    const { message, status } = req.body;

    const query = await Query.findById(id);
    if (!query) return res.status(404).json({ success: false, message: 'Query not found' });

    // Append history
    query.history.push({
      sender: req.user._id,
      message
    });

    const adminDept = await resolveUserDepartment(req.user);
    if (adminDept?._id && query.department && adminDept._id.toString() === query.department.toString()) {
      query.ownerStatus = status ? status : 'resolved';
    }
    if (adminDept?._id) {
      const deptIdStr = adminDept._id.toString();
      query.collaboratorStatuses = Array.isArray(query.collaboratorStatuses) ? query.collaboratorStatuses : [];
      const idx = query.collaboratorStatuses.findIndex((cs) => cs?.department?.toString() === deptIdStr);
      if (idx !== -1 && (status ? status === 'resolved' : true)) {
        query.collaboratorStatuses[idx].status = 'resolved';
        query.collaboratorStatuses[idx].updatedAt = new Date();
      }
    }

    const allCollabsResolved = (query.collaboratorStatuses || []).every((cs) => cs.status === 'resolved');
    const nextStatus = query.ownerStatus === 'resolved' && allCollabsResolved ? 'resolved' : 'pending';
    if (query.status !== 'escalated' && query.status !== 'answered') {
      query.status = nextStatus;
    }

    query.assignedTo = req.user._id;
    await query.save();

    // Notify Student
    if (global.io) {
      global.io.to(query.userId.toString()).emit('query:update', query);
    }

    return res.json({ success: true, data: query });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to reply' });
  }
});

// 5. PATCH /api/ai/queries/:id/transfer - Transfer to another Department
router.patch('/queries/:id/transfer', authenticate, authorize('admin', 'faculty', 'hod'), async (req, res) => {
  try {
    const { id } = req.params;
    const { toDepartment, note } = req.body || {};

    const query = await Query.findById(id);
    if (!query) return res.status(404).json({ success: false, message: 'Query not found' });

    const toDept = await resolveDepartment(toDepartment);
    if (!toDept?._id) return res.status(400).json({ success: false, message: 'Valid toDepartment is required' });

    const fromDepartment = query.department || null;

    query.department = toDept._id;
    query.tag = ALLOWED_QUERY_TAGS.has(toDept.name) ? toDept.name : 'Other';
    query.status = 'pending';
    query.assignedTo = null;
    query.transfers = Array.isArray(query.transfers) ? query.transfers : [];
    query.transfers.push({
      fromDepartment,
      toDepartment: toDept._id,
      by: req.user._id,
      note: typeof note === 'string' ? note : ''
    });

    await query.save();

    const populated = await Query.findById(query._id)
      .populate('userId', 'profile.firstName profile.lastName email')
      .populate('department')
      .populate('originDepartment')
      .populate('collaboratingDepartments')
      .populate({ path: 'transfers.fromDepartment', select: 'name' })
      .populate({ path: 'transfers.toDepartment', select: 'name' })
      .populate({ path: 'transfers.by', select: 'profile.firstName profile.lastName email' })
      .populate({ path: 'collaboratorStatuses.department', select: 'name' });

    if (global.io) {
      global.io.to(query.userId.toString()).emit('query:update', populated);
    }

    const departmentsToNotify = [];
    if (fromDepartment) departmentsToNotify.push(fromDepartment.toString());
    departmentsToNotify.push(toDept._id.toString());
    const uniqueDeptIds = Array.from(new Set(departmentsToNotify));

    for (const deptId of uniqueDeptIds) {
      const dept = await Department.findById(deptId);
      if (dept?.admins?.length && global.io) {
        dept.admins.forEach((adminId) => {
          global.io.to(adminId.toString()).emit('query:update', populated);
        });
      }
    }

    return res.json({ success: true, data: populated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Failed to transfer query' });
  }
});

// 6. POST /api/ai/queries/:id/collaborators - Add collaborating Department
router.post('/queries/:id/collaborators', authenticate, authorize('admin', 'faculty', 'hod'), async (req, res) => {
  try {
    const { id } = req.params;
    const { department } = req.body || {};

    const query = await Query.findById(id);
    if (!query) return res.status(404).json({ success: false, message: 'Query not found' });

    const d = await resolveDepartment(department);
    if (!d?._id) return res.status(400).json({ success: false, message: 'Valid department is required' });

    const deptIdStr = d._id.toString();
    const currentDeptIdStr = query.department ? query.department.toString() : null;
    if (currentDeptIdStr && deptIdStr === currentDeptIdStr) {
      return res.json({ success: true, data: query });
    }

    query.collaboratingDepartments = Array.isArray(query.collaboratingDepartments) ? query.collaboratingDepartments : [];
    const existing = query.collaboratingDepartments.map((v) => v.toString());
    if (!existing.includes(deptIdStr)) query.collaboratingDepartments.push(d._id);

    await query.save();

    const populated = await Query.findById(query._id)
      .populate('userId', 'profile.firstName profile.lastName email')
      .populate('department')
      .populate('originDepartment')
      .populate('collaboratingDepartments')
      .populate({ path: 'transfers.fromDepartment', select: 'name' })
      .populate({ path: 'transfers.toDepartment', select: 'name' })
      .populate({ path: 'transfers.by', select: 'profile.firstName profile.lastName email' })
      .populate({ path: 'collaboratorStatuses.department', select: 'name' });

    if (d?.admins?.length && global.io) {
      d.admins.forEach((adminId) => {
        global.io.to(adminId.toString()).emit('query:new', populated);
      });
    }

    if (global.io) {
      global.io.to(query.userId.toString()).emit('query:update', populated);
    }

    return res.json({ success: true, data: populated });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Failed to add collaborator' });
  }
});

// 7. PATCH /api/ai/queries/:id/escalate - Convert to HelpDesk Ticket
router.patch('/queries/:id/escalate', authenticate, authorize('admin', 'faculty', 'hod'), async (req, res) => {
  try {
    const { id } = req.params;
    const query = await Query.findById(id).populate('userId');
    if (!query) return res.status(404).json({ success: false, message: 'Query not found' });

    const categoryByTag = {
      IT: 'it_support',
      Finance: 'financial',
      Exams: 'academic',
      Admissions: 'administrative',
      Hostel: 'facilities',
      Library: 'library',
      Career: 'other',
      Other: 'other',
    };
    const category = categoryByTag[query.tag] || 'other';

    // Create Ticket
    const ticket = new Ticket({
      reportedBy: query.userId._id,
      title: `Escalated: ${query.tag} Query`,
      description: `Escalated from AI Query System.\n\nOriginal Message: ${query.message}\n\nHistory:\n${query.history.map(h => `- ${h.message}`).join('\n')}`,
      category,
      priority: 'medium',
      status: 'open',
      department: query.tag || 'general',
      escalated: true,
      escalatedAt: new Date(),
      tags: ['ai-escalation']
    });

    await ticket.save();

    query.status = 'escalated';
    query.resolution = `Escalated to Ticket #${ticket._id}`;
    await query.save();

    return res.json({ success: true, data: { query, ticket } });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Failed to escalate' });
  }
});

// 8. PATCH /api/ai/queries/:id/tags - Admin sets topic tags on a query
router.patch('/queries/:id/tags', authenticate, authorize('admin', 'faculty', 'hod'), async (req, res) => {
  try {
    const { id } = req.params;
    const { topicTags } = req.body;

    const ALLOWED_TOPICS = ['Fee', 'Transcript', 'Internship', 'Scholarship', 'Registration', 'Grading', 'Course Drop', 'Leave', 'Hostel', 'Other'];
    if (!Array.isArray(topicTags)) {
      return res.status(400).json({ success: false, message: 'topicTags must be an array' });
    }
    const sanitized = topicTags.filter(t => ALLOWED_TOPICS.includes(t));

    const query = await Query.findByIdAndUpdate(
      id,
      { topicTags: sanitized },
      { new: true }
    ).populate('userId', 'profile.firstName profile.lastName email');

    if (!query) return res.status(404).json({ success: false, message: 'Query not found' });

    if (global.io) global.io.to(query.userId._id.toString()).emit('query:update', query);

    return res.json({ success: true, data: query });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update topic tags' });
  }
});

// 9. GET /api/ai/analytics/topics - Topic tag frequency for analytics
router.get('/analytics/topics', authenticate, authorize('admin', 'faculty', 'hod'), async (req, res) => {
  try {
    const { department, since } = req.query;
    const matchStage = {};

    if (department) {
      const d = await resolveDepartment(department);
      if (d?._id) matchStage.$or = [{ department: d._id }, { collaboratingDepartments: d._id }];
      else if (ALLOWED_QUERY_TAGS.has(department)) matchStage.tag = department;
    }
    if (since) {
      const d = new Date(since);
      if (!isNaN(d)) matchStage.createdAt = { $gte: d };
    }

    const pipeline = [
      { $match: matchStage },
      { $unwind: { path: '$topicTags', preserveNullAndEmpty: false } },
      { $group: { _id: '$topicTags', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ];

    const results = await Query.aggregate(pipeline);
    return res.json({ success: true, data: results });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch topic analytics' });
  }
});

// 6. POST /api/ai/departments - Create/Update Departments (Admin only)
router.post('/departments', authenticate, authorize('admin'), async (req, res) => {
    try {
        const { name, keywords, admins } = req.body;
        let dept = await Department.findOne({ name });
        if (dept) {
            if (keywords) dept.keywords = keywords;
            if (admins) dept.admins = admins;
            await dept.save();
        } else {
            dept = await Department.create({ name, keywords, admins });
        }
        return res.json({ success: true, data: dept });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Failed to manage department' });
    }
});

router.get('/departments/public', async (req, res) => {
    try {
        const depts = await Department.find().select('name keywords admins');
        return res.json({ success: true, data: depts });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Failed to list departments' });
    }
});

router.get('/departments', authenticate, authorize('admin', 'faculty', 'hod'), async (req, res) => {
    try {
        const depts = await Department.find();
        return res.json({ success: true, data: depts });
    } catch (e) {
        return res.status(500).json({ success: false, message: 'Failed to list departments' });
    }
});

module.exports = router;