const Classroom = require('../models/Classroom');
const User = require('../models/User');
const { sendClassroomNotification } = require('../utils/emailService');

// Create a new class (Faculty only)
const createClass = async (req, res) => {
  try {
    const { name, section } = req.body;
    const facultyId = req.user._id;

    const newClass = new Classroom({
      name,
      section,
      faculty: facultyId
    });

    await newClass.save();

    res.status(201).json({
      success: true,
      message: 'Classroom deployed successfully',
      data: newClass
    });
  } catch (error) {
    console.error('Create Class Error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to create classroom'
    });
  }
};

// Join a class using code (Student only)
const joinClass = async (req, res) => {
  try {
    const { code } = req.body;
    const studentId = req.user._id;

    const classroom = await Classroom.findOne({ code: code.toUpperCase() });

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Invalid classroom code. Security protocol rejected access.'
      });
    }

    // Check if already joined
    if (classroom.students.includes(studentId)) {
      return res.status(400).json({
        success: false,
        message: 'You are already authenticated in this classroom.'
      });
    }

    classroom.students.push(studentId);
    await classroom.save();

    res.status(200).json({
      success: true,
      message: 'Neural link established. You have joined the classroom.',
      data: classroom
    });
  } catch (error) {
    console.error('Join Class Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to join classroom'
    });
  }
};

// Get all classes for the current user (Role based)
const getMyClasses = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    let query = {};
    if (role === 'faculty' || role === 'hod') {
      query = { faculty: userId };
    } else if (role === 'student') {
      query = { students: userId };
    } else {
      return res.status(403).json({ success: false, message: 'Unauthorized role' });
    }

    const classes = await Classroom.find(query)
      .populate('faculty', 'profile.firstName profile.lastName profile.avatar')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: classes
    });
  } catch (error) {
    console.error('Get My Classes Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch classrooms'
    });
  }
};

// Upload material to a class (Faculty only)
const uploadMaterial = async (req, res) => {
  try {
    const { classId } = req.params;
    const { title, description, fileUrl, fileType, topic } = req.body;
    const facultyId = req.user._id;

    const classroom = await Classroom.findOne({ _id: classId, faculty: facultyId });

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Classroom not found or unauthorized'
      });
    }

    classroom.materials.push({
      title,
      description,
      fileUrl,
      fileType,
      topic: topic || 'General'
    });

    await classroom.save();

    // Trigger Email Notification (Non-blocking)
    const { sendClassroomNotification } = require('../utils/emailService');
    sendClassroomNotification('material', classroom, { title, description });

    res.status(200).json({
      success: true,
      message: 'Educational data uploaded successfully',
      data: classroom.materials
    });
  } catch (error) {
    console.error('Upload Material Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to upload material'
    });
  }
};

// Get classroom details (Access check)
const getClassDetails = async (req, res) => {
  try {
    const { classId } = req.params;
    const userId = req.user._id;

    const classroom = await Classroom.findById(classId)
      .populate('faculty', 'profile.firstName profile.lastName profile.avatar profile.designation profile.department')
      .populate('students', 'profile.firstName profile.lastName profile.avatar profile.studentId');

    if (!classroom) {
      return res.status(404).json({ success: false, message: 'Classroom not found' });
    }

    // Security check: must be faculty or enrolled student
    const isFaculty = classroom.faculty._id.toString() === userId.toString();
    const isStudent = classroom.students.some(s => s._id.toString() === userId.toString());

    if (!isFaculty && !isStudent) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized access. You are not enrolled in this mainframe.'
      });
    }

    res.status(200).json({
      success: true,
      data: classroom
    });
  } catch (error) {
    console.error('Get Class Details Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch classroom intelligence'
    });
  }
};

// Post an announcement (Faculty only)
const postAnnouncement = async (req, res) => {
  try {
    const { classId } = req.params;
    const { content } = req.body;
    const facultyId = req.user._id;

    const classroom = await Classroom.findOne({ _id: classId, faculty: facultyId });

    if (!classroom) {
      return res.status(404).json({
        success: false,
        message: 'Classroom not found or unauthorized'
      });
    }

    classroom.announcements.push({ content });
    await classroom.save();

    // Trigger Email Notification (Non-blocking)
    sendClassroomNotification('announcement', classroom, { content });

    res.status(200).json({
      success: true,
      message: 'Announcement broadcasted',
      data: classroom.announcements
    });
  } catch (error) {
    console.error('Post Announcement Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to post announcement'
    });
  }
};

// Create an assignment (Faculty only)
const createAssignment = async (req, res) => {
  try {
    const { classId } = req.params;
    const { title, description, dueDate, maxPoints, fileUrl, topic } = req.body;
    const facultyId = req.user._id;

    const classroom = await Classroom.findOne({ _id: classId, faculty: facultyId });
    if (!classroom) return res.status(404).json({ success: false, message: 'Classroom not found' });

    classroom.assignments.push({ title, description, dueDate, maxPoints, fileUrl, topic });
    await classroom.save();

    // Trigger Email Notification (Non-blocking)
    sendClassroomNotification('assignment', classroom, { title, description, dueDate, maxPoints });

    res.status(200).json({ success: true, message: 'Assignment created', data: classroom.assignments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create assignment' });
  }
};

// Submit an assignment (Student only)
const submitAssignment = async (req, res) => {
  try {
    const { classId, assignmentId } = req.params;
    const { fileUrl, content } = req.body;
    const studentId = req.user._id;

    const classroom = await Classroom.findById(classId);
    if (!classroom) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const assignment = classroom.assignments.id(assignmentId);
    if (!assignment) return res.status(404).json({ success: false, message: 'Assignment not found' });

    // Check if already submitted
    const existingSubmission = assignment.submissions.find(s => s.student.toString() === studentId.toString());
    if (existingSubmission) {
      existingSubmission.fileUrl = fileUrl;
      existingSubmission.content = content;
      existingSubmission.submittedAt = Date.now();
    } else {
      assignment.submissions.push({ student: studentId, fileUrl, content });
    }

    await classroom.save();
    res.status(200).json({ success: true, message: 'Assignment submitted successfully', data: assignment });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to submit assignment' });
  }
};

// Add a topic to class (Faculty only)
const addTopic = async (req, res) => {
  try {
    const { classId } = req.params;
    const { name } = req.body;
    const facultyId = req.user._id;

    const classroom = await Classroom.findOne({ _id: classId, faculty: facultyId });
    if (!classroom) return res.status(404).json({ success: false, message: 'Classroom not found' });

    if (!classroom.topics.includes(name)) {
      classroom.topics.push(name);
      await classroom.save();
    }

    res.status(200).json({ success: true, data: classroom.topics });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to add topic' });
  }
};

// Grade a submission (Faculty only)
const gradeSubmission = async (req, res) => {
  try {
    const { classId, assignmentId, submissionId } = req.params;
    const { grade, feedback } = req.body;
    const facultyId = req.user._id;

    const classroom = await Classroom.findOne({ _id: classId, faculty: facultyId });
    if (!classroom) return res.status(404).json({ success: false, message: 'Classroom not found' });

    const assignment = classroom.assignments.id(assignmentId);
    const submission = assignment.submissions.id(submissionId);
    
    if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

    submission.grade = grade;
    submission.feedback = feedback;

    await classroom.save();
    res.status(200).json({ success: true, message: 'Grade saved successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to grade submission' });
  }
};

module.exports = {
  createClass,
  joinClass,
  getMyClasses,
  uploadMaterial,
  getClassDetails,
  postAnnouncement,
  createAssignment,
  submitAssignment,
  addTopic,
  gradeSubmission
};
