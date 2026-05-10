const User = require('../models/User');
const emailService = require('../utils/emailService');

// Get all faculty members in HOD's department (pending approval)
const getPendingFaculty = async (req, res) => {
  try {
    const hodId = req.user._id;
    const hod = await User.findById(hodId);

    if (hod.role !== 'hod') {
      return res.status(403).json({
        success: false,
        message: 'Only HODs can access this'
      });
    }

    const department = hod.profile.department;
    
    // Get pending faculty from the same department
    const pendingFaculty = await User.find({
      role: 'faculty',
      'profile.department': department,
      approvalStatus: 'pending'
    }).select('-password');

    res.status(200).json({
      success: true,
      data: {
        pendingFaculty,
        count: pendingFaculty.length
      }
    });
  } catch (error) {
    console.error('Get Pending Faculty Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending faculty'
    });
  }
};

// Get approved faculty members under HOD
const getApprovedFaculty = async (req, res) => {
  try {
    const hodId = req.user._id;
    const hod = await User.findById(hodId);

    if (hod.role !== 'hod') {
      return res.status(403).json({
        success: false,
        message: 'Only HODs can access this'
      });
    }

    const department = hod.profile.department;
    
    // Get approved faculty from the same department
    const approvedFaculty = await User.find({
      role: 'faculty',
      'profile.department': department,
      approvalStatus: 'approved'
    }).select('-password');

    res.status(200).json({
      success: true,
      data: {
        approvedFaculty,
        count: approvedFaculty.length
      }
    });
  } catch (error) {
    console.error('Get Approved Faculty Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch approved faculty'
    });
  }
};

// Approve faculty member
const approveFaculty = async (req, res) => {
  try {
    const { facultyId } = req.params;
    const hodId = req.user._id;
    
    const hod = await User.findById(hodId);
    if (hod.role !== 'hod') {
      return res.status(403).json({
        success: false,
        message: 'Only HODs can approve faculty'
      });
    }

    // Find faculty member
    const faculty = await User.findById(facultyId);
    if (!faculty || faculty.role !== 'faculty') {
      return res.status(404).json({
        success: false,
        message: 'Faculty member not found'
      });
    }

    // Check if faculty is from same department
    if (faculty.profile.department !== hod.profile.department) {
      return res.status(403).json({
        success: false,
        message: 'You can only approve faculty from your department'
      });
    }

    // Approve the faculty
    faculty.isApproved = true;
    faculty.approvalStatus = 'approved';
    faculty.approvedBy = hodId;
    faculty.approvedAt = new Date();
    faculty.rejectionReason = null;

    await faculty.save();

    console.log(`✅ Faculty ${faculty.email} approved by HOD ${hod.profile.firstName} ${hod.profile.lastName}`);

    // Send approval email to faculty
    try {
      const hodName = `${hod.profile.firstName} ${hod.profile.lastName}`;
      await emailService.sendFacultyApprovalEmail(
        faculty.email,
        faculty.profile.firstName,
        faculty.profile.department,
        hodName
      );
      console.log(`📧 Approval email sent to ${faculty.email}`);
    } catch (emailError) {
      console.error('Failed to send approval email:', emailError);
      // Continue even if email fails
    }

    res.status(200).json({
      success: true,
      message: `Faculty ${faculty.profile.firstName} ${faculty.profile.lastName} approved successfully`,
      data: {
        faculty: {
          _id: faculty._id,
          email: faculty.email,
          profile: faculty.profile,
          approvalStatus: faculty.approvalStatus,
          approvedAt: faculty.approvedAt
        }
      }
    });
  } catch (error) {
    console.error('Approve Faculty Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to approve faculty'
    });
  }
};

// Reject faculty member
const rejectFaculty = async (req, res) => {
  try {
    const { facultyId } = req.params;
    const { rejectionReason } = req.body;
    const hodId = req.user._id;
    
    const hod = await User.findById(hodId);
    if (hod.role !== 'hod') {
      return res.status(403).json({
        success: false,
        message: 'Only HODs can reject faculty'
      });
    }

    // Find faculty member
    const faculty = await User.findById(facultyId);
    if (!faculty || faculty.role !== 'faculty') {
      return res.status(404).json({
        success: false,
        message: 'Faculty member not found'
      });
    }

    // Check if faculty is from same department
    if (faculty.profile.department !== hod.profile.department) {
      return res.status(403).json({
        success: false,
        message: 'You can only reject faculty from your department'
      });
    }

    // Reject the faculty
    faculty.isApproved = false;
    faculty.approvalStatus = 'rejected';
    faculty.rejectionReason = rejectionReason || 'Rejected by HOD';
    faculty.approvedBy = hodId;
    faculty.approvedAt = new Date();

    await faculty.save();

    console.log(`❌ Faculty ${faculty.email} rejected by HOD ${hod.profile.firstName} ${hod.profile.lastName}`);

    // Send rejection email to faculty
    try {
      const hodName = `${hod.profile.firstName} ${hod.profile.lastName}`;
      await emailService.sendFacultyRejectionEmail(
        faculty.email,
        faculty.profile.firstName,
        faculty.profile.department,
        hodName,
        rejectionReason
      );
      console.log(`📧 Rejection email sent to ${faculty.email}`);
    } catch (emailError) {
      console.error('Failed to send rejection email:', emailError);
      // Continue even if email fails
    }

    res.status(200).json({
      success: true,
      message: `Faculty ${faculty.profile.firstName} ${faculty.profile.lastName} rejected`,
      data: {
        faculty: {
          _id: faculty._id,
          email: faculty.email,
          profile: faculty.profile,
          approvalStatus: faculty.approvalStatus,
          rejectionReason: faculty.rejectionReason
        }
      }
    });
  } catch (error) {
    console.error('Reject Faculty Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reject faculty'
    });
  }
};

// Get HOD dashboard statistics
const getHodStats = async (req, res) => {
  try {
    const hodId = req.user._id;
    const hod = await User.findById(hodId);

    if (hod.role !== 'hod') {
      return res.status(403).json({
        success: false,
        message: 'Only HODs can access this'
      });
    }

    const department = hod.profile.department;

    const pendingCount = await User.countDocuments({
      role: 'faculty',
      'profile.department': department,
      approvalStatus: 'pending'
    });

    const approvedCount = await User.countDocuments({
      role: 'faculty',
      'profile.department': department,
      approvalStatus: 'approved'
    });

    const rejectedCount = await User.countDocuments({
      role: 'faculty',
      'profile.department': department,
      approvalStatus: 'rejected'
    });

    res.status(200).json({
      success: true,
      data: {
        department,
        stats: {
          pending: pendingCount,
          approved: approvedCount,
          rejected: rejectedCount,
          total: pendingCount + approvedCount + rejectedCount
        }
      }
    });
  } catch (error) {
    console.error('Get HOD Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statistics'
    });
  }
};

// Get all students in HOD's department
const getStudents = async (req, res) => {
  try {
    const hodId = req.user._id;
    const hod = await User.findById(hodId);
    const department = hod.profile.department;

    const students = await User.find({
      role: 'student',
      'profile.department': department
    }).select('-password');

    res.status(200).json({
      success: true,
      data: students
    });
  } catch (error) {
    console.error('Get Department Students Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch students'
    });
  }
};

// Perform action (warning, meeting, rule-break) on faculty/student
const performAction = async (req, res) => {
  try {
    const { targetId, actionType, message } = req.body;
    const hodId = req.user._id;

    const hod = await User.findById(hodId);
    const department = hod.profile.department;

    const target = await User.findById(targetId);
    if (!target) {
      return res.status(404).json({
        success: false,
        message: 'Target user not found'
      });
    }

    // Security check: Department-wise only
    if (target.profile.department !== department) {
      return res.status(403).json({
        success: false,
        message: 'You can only take action on members of your department'
      });
    }

    const hodName = `${hod.profile.firstName} ${hod.profile.lastName}`;
    const targetName = `${target.profile.firstName} ${target.profile.lastName}`;

    // Handle Revocation
    if (actionType === 'revoke') {
      target.isActive = false;
      await target.save();
    }

    // Send email
    const emailRes = await emailService.sendHODActionEmail(
      target.email,
      targetName,
      hodName,
      department,
      actionType,
      message
    );

    if (!emailRes.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to send action email'
      });
    }

    res.status(200).json({
      success: true,
      message: `Action '${actionType}' successfully taken on ${targetName}`
    });

  } catch (error) {
    console.error('HOD Perform Action Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to perform action'
    });
  }
};

module.exports = {
  getPendingFaculty,
  getApprovedFaculty,
  approveFaculty,
  rejectFaculty,
  getHodStats,
  getStudents,
  performAction
};
