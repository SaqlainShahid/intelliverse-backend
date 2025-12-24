const Groq = require('groq-sdk');
const Internship = require('../models/Internship');
const CareerTip = require('../models/CareerTip');
const CareerMessage = require('../models/CareerMessage');
const InternshipApplication = require('../models/InternshipApplication');
const Notification = require('../models/Notification');
const User = require('../models/User');
const { sendEmail, getCareerPostingAnnouncementTemplate, getCareerPostingStatusTemplate, getCareerApplicationStatusTemplate } = require('../utils/emailService');

const groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });

const getInternships = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      skills,
      location,
      type,
      q,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = req.query;

    const filter = {};
    if (type) filter.type = type;
    if (location) filter.location = new RegExp(location, 'i');
    if (skills) {
      const skillArr = String(skills)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (skillArr.length) filter.skillsRequired = { $in: skillArr };
    }
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { company: { $regex: q, $options: 'i' } },
        { location: { $regex: q, $options: 'i' } },
        { eligibility: { $regex: q, $options: 'i' } },
        { description: { $regex: q, $options: 'i' } },
        { skillsRequired: { $elemMatch: { $regex: q, $options: 'i' } } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sort = {};
    sort[sortBy] = sortOrder === 'desc' ? -1 : 1;

    const role = req.user?.role;
    if (role === 'student') {
      filter.status = 'approved';
    }

    const items = await Internship.find(filter).sort(sort).skip(skip).limit(parseInt(limit));
    const total = await Internship.countDocuments(filter);

    return res.json({
      success: true,
      data: {
        items,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          hasNext: skip + items.length < total,
          hasPrev: parseInt(page) > 1,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch internships', error: error.message });
  }
};

const getTips = async (req, res) => {
  try {
    const { category, q, limit = 50 } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { content: { $regex: q, $options: 'i' } },
        { tags: { $elemMatch: { $regex: q, $options: 'i' } } },
      ];
    }
    const tips = await CareerTip.find(filter).sort({ createdAt: -1 }).limit(parseInt(limit));
    return res.json({ success: true, data: tips });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch tips', error: error.message });
  }
};

const buildCareerPrompt = ({ user, message, internships, skills, intent }) => {
  const profile = user?.profile || {};
  const profileText = `Student Profile:
- Name: ${user?.profile?.firstName || ''} ${user?.profile?.lastName || ''}
- Department: ${profile.department || 'N/A'}
- Semester: ${profile.semester || 'N/A'}
- CGPA: ${typeof profile.cgpa === 'number' ? profile.cgpa : 'N/A'}
- Known skills: ${Array.isArray(skills) && skills.length ? skills.join(', ') : 'Not provided'}
`;
  const contextText =
    internships && internships.length
      ? `Relevant Opportunities:
${internships
  .map(
    (it, idx) =>
      `${idx + 1}. ${it.title} at ${it.company}
   - Type: ${it.type}
   - Location: ${it.location}
   - Skills: ${Array.isArray(it.skillsRequired) ? it.skillsRequired.join(', ') : 'N/A'}
   - Stipend/Salary: ${it.stipend || 'N/A'}
   - Eligibility: ${it.eligibility || 'N/A'}
   - Deadline: ${it.deadline ? new Date(it.deadline).toDateString() : 'N/A'}
   - Apply: ${it.applyLink}`
  )
  .join('\n')}`
      : 'No relevant internships found in the database for the provided skills.';

  const systemPrompt = `You are an AI Career Guidance Counselor for university students.
You must:
- Recommend internships/jobs that match the student's skills and department.
- Provide a brief career path outline with skill roadmap.
- Suggest resume improvements tailored to target roles.
- Reference the provided opportunities when possible.
- Keep answers concise, friendly, and actionable.
- Respond in under 120 words with short bullet points only.
- Avoid paragraphs, salutations, and redundant wording.
`;

  const intentKey = String(intent || '').toLowerCase();
  const intentInstructions = (() => {
    switch (intentKey) {
      case 'greeting':
        return `Provide a short option menu. Output 5 bullets only: Matching roles; Top opportunities; Skill roadmap; Resume tips; Interview prep.`;
      case 'roles':
        return `Focus on matching roles (3 bullets). Each bullet: Role — one-line reason.`;
      case 'opportunities':
        return `List top 3 matching opportunities from "Relevant Opportunities". Each bullet: Title at Company — brief fit; include "Apply:" link if present.`;
      case 'roadmap':
        return `Provide a 3-stage skill roadmap. Each stage: 3 skills/tools in one bullet.`;
      case 'resume':
        return `Provide 5 resume improvement bullets. Include one sample bullet with metrics.`;
      case 'interview':
        return `Provide 5 common interview Qs with short model answers (one line each).`;
      default:
        return `Provide 3 matching roles and a 3-stage roadmap, plus 3 resume tips (short bullets).`;
    }
  })();

  const userPrompt = `Student message: "${message}"

${profileText}

Use the following opportunities to inform recommendations:
${contextText}

Task:
${intentInstructions}
Output rules:
- Use only bullet points
- Keep it concise (max ~120 words total)
- Use plain text (no markdown headers)
`;
  return { systemPrompt, userPrompt };
};

const chatCareer = async (req, res) => {
  try {
    const { message, skills, intent } = req.body;
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ success: false, message: 'Message is required' });
    }

    const user = req.user;
    const skillArr =
      Array.isArray(skills) && skills.length
        ? skills.map((s) => String(s).trim()).filter(Boolean)
        : [];

    let related;
    if (skillArr.length) {
      related = await Internship.find({ skillsRequired: { $in: skillArr } })
        .sort({ deadline: 1 })
        .limit(8);
    } else {
      // Fallback: use department keywords to search
      const dept = user?.profile?.department || '';
      const keywords = dept
        ? dept.split(/\s+/).filter(Boolean)
        : [];
      related = await Internship.find({
        $or: [
          { title: { $regex: keywords.join('|'), $options: 'i' } },
          { description: { $regex: keywords.join('|'), $options: 'i' } },
          { skillsRequired: { $elemMatch: { $regex: keywords.join('|'), $options: 'i' } } },
        ],
      })
        .sort({ deadline: 1 })
        .limit(8);
    }

    const { systemPrompt, userPrompt } = buildCareerPrompt({
      user,
      message,
      internships: related,
      skills: skillArr,
      intent,
    });

    const resp = await groqClient.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      temperature: 0.7,
    });
    const answer = resp?.choices?.[0]?.message?.content?.trim() || '';

    const recommendedIds = related.map((r) => r._id);
    if (user?._id) {
      await CareerMessage.create({
        userId: user._id,
        role: 'user',
        content: message,
        usedSkills: skillArr,
        recommendedIds,
        model: 'llama-3.1-8b-instant',
      });
      await CareerMessage.create({
        userId: user._id,
        role: 'assistant',
        content: answer,
        usedSkills: skillArr,
        recommendedIds,
        model: 'llama-3.1-8b-instant',
      });
    }

    return res.json({
      success: true,
      data: {
        answer,
        recommendedIds,
        usedSkills: skillArr,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to get AI guidance', error: error.message });
  }
};

const getChatHistory = async (req, res) => {
  try {
    const { limit = 100 } = req.query;
    const items = await CareerMessage.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    return res.json({ success: true, data: { messages: items } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to fetch chat history', error: error.message });
  }
};

const clearChatHistory = async (req, res) => {
  try {
    const result = await CareerMessage.deleteMany({ userId: req.user._id });
    return res.json({ success: true, data: { deleted: result?.deletedCount || 0 } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to clear chat history', error: error.message });
  }
};

const improveResume = async (req, res) => {
  try {
    const { role, resumeText, tone } = req.body;
    if (!role || !resumeText) {
      return res.status(400).json({ success: false, message: 'Role and resumeText are required' });
    }
    const toneKey = String(tone || 'concise').toLowerCase();
    const toneText =
      toneKey === 'professional'
        ? 'Use a professional tone.'
        : toneKey === 'friendly'
        ? 'Use a friendly tone.'
        : 'Use a concise tone.';
    const systemPrompt = `You are an expert resume reviewer for university students applying to internships and entry-level roles.
${toneText}
You must keep answers short and only use bullet points. Do not use paragraphs or salutations.`;
    const userPrompt = `Target role: ${role}

Resume content:
${resumeText}

Return the following as short bullet points only (≤120 words total):
- Top improvements (3 bullets)
- One-line summary suggestion
- 3-5 role-aligned bullets with metrics
- 8-12 keywords to include`;
    const resp = await groqClient.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      temperature: 0.7,
    });
    const answer = resp?.choices?.[0]?.message?.content?.trim() || '';
    return res.json({ success: true, data: { advice: answer } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to get AI guidance', error: error.message });
  }
};

const createInternship = async (req, res) => {
  try {
    const payload = req.body || {};
    const base = {
      title: String(payload.title || '').trim(),
      company: String(payload.company || '').trim(),
      location: String(payload.location || '').trim(),
      type: String(payload.type || '').trim(),
      skillsRequired: Array.isArray(payload.skillsRequired) ? payload.skillsRequired : (typeof payload.skillsRequired === 'string' ? payload.skillsRequired.split(',').map(s => s.trim()).filter(Boolean) : []),
      stipend: payload.stipend || null,
      eligibility: payload.eligibility || '',
      deadline: payload.deadline ? new Date(payload.deadline) : null,
      applyLink: String(payload.applyLink || '').trim(),
      description: payload.description || '',
      createdBy: req.user._id,
      status: req.user.role === 'admin' ? 'approved' : 'pending'
    };
    if (!base.title || !base.company || !base.location || !base.type || !base.applyLink) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }
    const doc = await Internship.create(base);
    return res.status(201).json({ success: true, data: doc });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to create internship', error: error.message });
  }
};

const updateInternship = async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await Internship.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    const canEdit = req.user.role === 'admin' || (doc.createdBy && doc.createdBy.toString() === req.user._id.toString());
    if (!canEdit) return res.status(403).json({ success: false, message: 'Forbidden' });
    const updates = { ...req.body };
    if (typeof updates.skillsRequired === 'string') {
      updates.skillsRequired = updates.skillsRequired.split(',').map(s => s.trim()).filter(Boolean);
    }
    const updated = await Internship.findByIdAndUpdate(id, updates, { new: true, runValidators: true });
    return res.json({ success: true, data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update internship', error: error.message });
  }
};

const deleteInternship = async (req, res) => {
  try {
    const id = req.params.id;
    const doc = await Internship.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    const canDelete = req.user.role === 'admin' || (doc.createdBy && doc.createdBy.toString() === req.user._id.toString());
    if (!canDelete) return res.status(403).json({ success: false, message: 'Forbidden' });
    await Internship.findByIdAndDelete(id);
    return res.json({ success: true, message: 'Deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to delete internship', error: error.message });
  }
};

const listManageInternships = async (req, res) => {
  try {
    const { status, q, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (q) {
      filter.$or = [
        { title: { $regex: q, $options: 'i' } },
        { company: { $regex: q, $options: 'i' } },
        { location: { $regex: q, $options: 'i' } },
      ];
    }
    if (req.user.role === 'faculty') {
      filter.createdBy = req.user._id;
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const items = await Internship.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit));
    const total = await Internship.countDocuments(filter);
    return res.json({ success: true, data: { items, total } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to list manage internships', error: error.message });
  }
};

const changeInternshipStatus = async (req, res) => {
  try {
    const id = req.params.id;
    const { status } = req.body;
    if (!['approved','rejected','pending','draft'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const doc = await Internship.findById(id);
    if (!doc) return res.status(404).json({ success: false, message: 'Not found' });
    const isAdmin = req.user.role === 'admin';
    const isFacultyOwner = req.user.role === 'faculty' && doc.createdBy && doc.createdBy.toString() === req.user._id.toString();
    if (!isAdmin && !isFacultyOwner) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
    const updated = await Internship.findByIdAndUpdate(
      id,
      { status, approvedBy: req.user._id, verifiedAt: status === 'approved' ? new Date() : null },
      { new: true }
    );
    try {
      const apps = await InternshipApplication.find({ internshipId: id }).populate('userId', 'email profile.firstName').lean();
      if (apps.length) {
        const notis = apps.map((a) => ({
          user: a.userId._id,
          type: 'career_posting_status',
          title: 'Opportunity Update',
          message: `${updated.title} was ${status}`,
          data: { internshipId: updated._id, status }
        }));
        await Notification.insertMany(notis, { ordered: false });
        if (status !== 'approved') {
          const subject = `Update: ${updated.title} is ${status}`;
          const html = getCareerPostingStatusTemplate(updated, status);
          await Promise.all(apps.map((a) => sendEmail(a.userId.email, subject, html)));
        }
      }
    } catch {}
    try {
      if (status === 'approved') {
        const students = await User.find({ role: 'student', isActive: true }).select('_id email').lean();
        if (students.length) {
          const notisAll = students.map((s) => ({
            user: s._id,
            type: 'career_new_posting',
            title: 'New Opportunity',
            message: `${updated.title} at ${updated.company} (${updated.location})`,
            data: { internshipId: updated._id, title: updated.title, company: updated.company, type: updated.type, location: updated.location, applyLink: updated.applyLink }
          }));
          await Notification.insertMany(notisAll, { ordered: false });
          const subjectAll = `New ${updated.type === 'job' ? 'Job' : 'Internship'} Approved: ${updated.title} at ${updated.company}`;
          const htmlAll = getCareerPostingAnnouncementTemplate(updated);
          await Promise.all(students.map((s) => sendEmail(s.email, subjectAll, htmlAll)));
        }
      }
    } catch {}
    return res.json({ success: true, data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to change status', error: error.message });
  }
};

const applyInternship = async (req, res) => {
  try {
    const id = req.params.id;
    const { coverLetter = '' } = req.body;
    const doc = await Internship.findById(id);
    if (!doc || doc.status !== 'approved') return res.status(404).json({ success: false, message: 'Not available' });
    const created = await InternshipApplication.create({
      internshipId: id,
      userId: req.user._id,
      coverLetter
    });
    return res.status(201).json({ success: true, data: created });
  } catch (error) {
    if (error && error.code === 11000) {
      return res.status(200).json({ success: true, message: 'Already applied' });
    }
    return res.status(500).json({ success: false, message: 'Failed to apply', error: error.message });
  }
};

const listApplications = async (req, res) => {
  try {
    const { internshipId, status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (internshipId) filter.internshipId = internshipId;
    if (status) filter.status = status;
    if (req.user.role === 'faculty') {
      const myIds = await Internship.find({ createdBy: req.user._id }).select('_id').lean();
      filter.internshipId = { $in: myIds.map(d => d._id) };
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const items = await InternshipApplication.find(filter)
      .populate('userId', 'profile.firstName profile.lastName email profile.studentId profile.department')
      .populate('internshipId', 'title company type')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const total = await InternshipApplication.countDocuments(filter);
    return res.json({ success: true, data: { items, total } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to list applications', error: error.message });
  }
};

const updateApplication = async (req, res) => {
  try {
    const id = req.params.id;
    const { status, notes } = req.body;
    if (status && !['applied','shortlisted','accepted','rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status' });
    }
    const app = await InternshipApplication.findById(id).populate('internshipId', 'createdBy');
    if (!app) return res.status(404).json({ success: false, message: 'Not found' });
    const canManage = req.user.role === 'admin' || (app.internshipId?.createdBy && app.internshipId.createdBy.toString() === req.user._id.toString());
    if (!canManage) return res.status(403).json({ success: false, message: 'Forbidden' });
    const updated = await InternshipApplication.findByIdAndUpdate(id, { ...(status && { status }), ...(notes !== undefined && { notes }) }, { new: true });
    try {
      const userId = app.userId;
      const user = await User.findById(userId).select('email').lean();
      if (user) {
        await Notification.create({
          user: userId,
          type: 'career_application_status',
          title: 'Application Update',
          message: `Your application is ${status || app.status}`,
          data: { applicationId: id, status: status || app.status }
        });
        const subject = `Application ${status || app.status}`;
        const html = getCareerApplicationStatusTemplate(
          await Internship.findById(app.internshipId).select('title company type applyLink').lean(),
          status || app.status
        );
        await sendEmail(user.email, subject, html);
      }
    } catch {}
    return res.json({ success: true, data: updated });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to update application', error: error.message });
  }
};

const listMyApplications = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const items = await InternshipApplication.find({ userId: req.user._id })
      .populate('internshipId', 'title company type location applyLink')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const total = await InternshipApplication.countDocuments({ userId: req.user._id });
    return res.json({ success: true, data: { items, total } });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Failed to list my applications', error: error.message });
  }
};

module.exports = {
  getInternships,
  getTips,
  chatCareer,
  getChatHistory,
  clearChatHistory,
  improveResume,
  createInternship,
  updateInternship,
  deleteInternship,
  listManageInternships,
  changeInternshipStatus,
  applyInternship,
  listApplications,
  updateApplication,
  listMyApplications,
};
