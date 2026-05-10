const User = require('../models/User');

// Get faculty statistics (for dashboard)
const getStats = async (req, res) => {
  try {
    const facultyId = req.user._id;
    const faculty = await User.findById(facultyId);

    if (faculty.role !== 'faculty' && faculty.role !== 'hod') {
      return res.status(403).json({
        success: false,
        message: 'Only faculty members or HODs can access this'
      });
    }

    // For now, return basic stats
    // TODO: Integrate with actual class/assignment models when implemented
    const stats = {
      assignments: 0,
      pendingReviews: 0,
      classes: 0,
      students: 0
    };

    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get Faculty Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

// Get faculty classes
const getClasses = async (req, res) => {
  try {
    const facultyId = req.user._id;
    const faculty = await User.findById(facultyId);

    if (faculty.role !== 'faculty' && faculty.role !== 'hod') {
      return res.status(403).json({
        success: false,
        message: 'Only faculty members or HODs can access this'
      });
    }

    // For now, return empty array
    // TODO: Implement class model and fetch faculty's classes
    const classes = [];

    res.status(200).json({
      success: true,
      data: classes
    });
  } catch (error) {
    console.error('Get Faculty Classes Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch classes'
    });
  }
};

// Get faculty students
const getStudents = async (req, res) => {
  try {
    const facultyId = req.user._id;
    const faculty = await User.findById(facultyId);

    if (faculty.role !== 'faculty' && faculty.role !== 'hod') {
      return res.status(403).json({
        success: false,
        message: 'Only faculty members or HODs can access this'
      });
    }

    const department = faculty.profile.department;

    // Get students from the same department
    const students = await User.find({
      role: 'student',
      'profile.department': department
    })
      .select('profile.firstName profile.lastName profile.studentId profile.semester profile.cgpa email')
      .lean();

    // Transform data for frontend
    const formattedStudents = students.map(student => ({
      _id: student._id,
      firstName: student.profile.firstName,
      lastName: student.profile.lastName,
      studentId: student.profile.studentId || 'N/A',
      class: `${department} - Semester ${student.profile.semester || 'N/A'}`,
      cgpa: student.profile.cgpa || 0.0,
      email: student.email
    }));

    res.status(200).json({
      success: true,
      data: formattedStudents
    });
  } catch (error) {
    console.error('Get Faculty Students Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
};

module.exports = {
  getStats,
  getClasses,
  getStudents
};
