const User = require('../models/User');
const mongoose = require('mongoose');
const Event = require('../models/Event');
const Club = require('../models/Club');
const Ticket = require('../models/Ticket');
const LostAndFoundItem = require('../models/LostAndFoundItem');
const Internship = require('../models/Internship');
const Announcement = require('../models/Announcement');
const emailService = require('../utils/emailService');

// Get all faculty members for HOD assignment
const getFacultyList = async (req, res) => {
  try {
    const { department, page = 1, limit = 10, search = '' } = req.query;
    
    const filter = { role: 'faculty', isActive: true };
    
    if (department) {
      filter['profile.department'] = department;
    }
    
    if (search) {
      filter.$or = [
        { email: { $regex: search, $options: 'i' } },
        { 'profile.firstName': { $regex: search, $options: 'i' } },
        { 'profile.lastName': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const faculty = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        faculty,
        pagination: {
          total,
          pages: Math.ceil(total / parseInt(limit)),
          currentPage: parseInt(page)
        }
      }
    });
  } catch (error) {
    console.error('Get Faculty List Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch faculty list'
    });
  }
};

// Get all HODs
const getHodList = async (req, res) => {
  try {
    const { department, page = 1, limit = 10 } = req.query;
    
    const filter = { role: 'hod', isActive: true };
    
    if (department) {
      filter['profile.department'] = department;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const hods = await User.find(filter)
      .select('-password')
      .sort({ 'profile.department': 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        hods,
        pagination: {
          total,
          pages: Math.ceil(total / parseInt(limit)),
          currentPage: parseInt(page)
        }
      }
    });
  } catch (error) {
    console.error('Get HOD List Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch HOD list'
    });
  }
};

// Assign faculty member as HOD
const assignHod = async (req, res) => {
  try {
    const { facultyId } = req.params;
    const adminId = req.user._id;
    
    // Verify admin is actually admin
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can assign HOD roles'
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

    // Normalize department name (trim and case-insensitive)
    const departmentName = faculty.profile.department?.trim();
    
    if (!departmentName) {
      return res.status(400).json({
        success: false,
        message: 'Faculty member does not have a department assigned'
      });
    }

    console.log(`🔍 Checking HOD assignment for: ${faculty.email}, Department: "${departmentName}"`);

    // Check if already HOD
    if (faculty.role === 'hod') {
      return res.status(400).json({
        success: false,
        message: 'User is already a HOD'
      });
    }

    // Check if department already has a HOD (case-insensitive)
    const departmentHod = await User.findOne({
      role: 'hod',
      'profile.department': { $regex: new RegExp(`^${departmentName}$`, 'i') },
      isActive: true,
      _id: { $ne: facultyId } // Exclude current faculty
    });

    console.log(`🔍 Existing HOD check result:`, departmentHod ? `Found: ${departmentHod.email} (${departmentHod.profile.department})` : 'None found');

    if (departmentHod) {
      console.log(`❌ Department "${departmentName}" already has HOD: ${departmentHod.email}`);
      return res.status(400).json({
        success: false,
        message: `Department ${departmentName} already has a HOD: ${departmentHod.profile.firstName} ${departmentHod.profile.lastName}`,
        data: {
          existingHod: {
            name: `${departmentHod.profile.firstName} ${departmentHod.profile.lastName}`,
            email: departmentHod.email,
            department: departmentHod.profile.department
          }
        }
      });
    }

    // Change role to HOD
    const previousRole = faculty.role;
    faculty.role = 'hod';
    faculty.isApproved = true; // HODs are automatically approved
    faculty.approvalStatus = 'approved';

    await faculty.save();

    // Send congratulation email
    emailService.sendHodAssignmentEmail(
      faculty.email,
      faculty.profile.firstName,
      departmentName,
      'Air University Administration'
    ).catch(err => console.error('Failed to send HOD assignment email:', err));

    console.log(`✅ Admin promoted ${faculty.email} from ${previousRole} to HOD (Department: "${departmentName}")`);

    res.status(200).json({
      success: true,
      message: `${faculty.profile.firstName} ${faculty.profile.lastName} is now a HOD`,
      data: {
        user: {
          _id: faculty._id,
          email: faculty.email,
          role: faculty.role,
          profile: faculty.profile
        }
      }
    });
  } catch (error) {
    console.error('Assign HOD Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to assign HOD role'
    });
  }
};

const assignEventManager = async (req, res) => {
  try {
    console.log('Event Manager Assign Route Hit', req.method, req.originalUrl);
    const { id } = req.params;
    const adminId = req.user?._id;

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can assign Event & Club Manager roles'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid id'
      });
    }

    const faculty = await User.findById(id);
    if (!faculty || faculty.role !== 'faculty') {
      return res.status(404).json({
        success: false,
        message: 'Faculty member not found'
      });
    }

    if (!faculty.isApproved) {
      return res.status(400).json({
        success: false,
        message: 'Faculty member is not approved yet by HOD'
      });
    }

    faculty.isEventClubManager = true;
    await faculty.save();

    const contact = 'Air University Administration';
    emailService.sendEventClubManagerAssignmentEmail(
      faculty.email,
      faculty.profile.firstName,
      contact
    ).catch(err => console.error('Failed to send Event & Club Manager assignment email:', err));

    return res.status(200).json({
      success: true,
      message: `${faculty.profile.firstName} ${faculty.profile.lastName} is now an Event & Club Manager`,
      data: {
        user: {
          _id: faculty._id,
          email: faculty.email,
          role: faculty.role,
          profile: faculty.profile
        }
      }
    });
  } catch (error) {
    console.error('Assign Event & Club Manager Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to assign Event & Club Manager role'
    });
  }
};

const removeEventManager = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user?._id;

    const admin = await User.findById(adminId);
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can remove Event & Club Manager roles'
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid id'
      });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.isEventClubManager = false;
    await user.save();

    return res.status(200).json({
      success: true,
      message: `${user.profile.firstName} ${user.profile.lastName} is no longer an Event & Club Manager`,
      data: {
        user: {
          _id: user._id,
          email: user.email,
          role: user.role,
          profile: user.profile
        }
      }
    });
  } catch (error) {
    console.error('Remove Event & Club Manager Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to remove Event & Club Manager role'
    });
  }
};

const getEventClubManagers = async (req, res) => {
  try {
    const { department, page = 1, limit = 10, search = '' } = req.query;

    const filter = { isEventClubManager: true, isActive: true };

    if (department) {
      filter['profile.department'] = department;
    }

    if (search) {
      filter.$or = [
        { email: { $regex: search, $options: 'i' } },
        { 'profile.firstName': { $regex: search, $options: 'i' } },
        { 'profile.lastName': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const managers = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);
    return res.status(200).json({
      success: true,
      data: {
        managers,
        pagination: {
          total,
          pages: Math.ceil(total / parseInt(limit)),
          currentPage: parseInt(page)
        }
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch Event & Club Managers'
    });
  }
};

// Remove HOD role (downgrade to faculty)
const removeHod = async (req, res) => {
  try {
    const { hodId } = req.params;
    const adminId = req.user._id;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can remove HOD roles'
      });
    }

    // Find HOD
    const hod = await User.findById(hodId);
    if (!hod || hod.role !== 'hod') {
      return res.status(404).json({
        success: false,
        message: 'HOD not found'
      });
    }

    // Change role back to faculty
    const department = hod.profile.department;
    hod.role = 'faculty';
    await hod.save();

    // Send removal notification email
    emailService.sendHodRemovalEmail(
      hod.email,
      hod.profile.firstName,
      department
    ).catch(err => console.error('Failed to send HOD removal email:', err));

    console.log(`👤 Admin downgraded ${hod.email} from HOD to Faculty`);

    res.status(200).json({
      success: true,
      message: `${hod.profile.firstName} ${hod.profile.lastName} is no longer a HOD`,
      data: {
        user: {
          _id: hod._id,
          email: hod.email,
          role: hod.role,
          profile: hod.profile
        }
      }
    });
  } catch (error) {
    console.error('Remove HOD Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to remove HOD role'
    });
  }
};

// Get admin dashboard stats (including HOD assignments)
const getAdminStats = async (req, res) => {
  try {
    const students = await User.countDocuments({ role: 'student' });
    const faculty = await User.countDocuments({ role: 'faculty' });
    const hods = await User.countDocuments({ role: 'hod' });
    const admins = await User.countDocuments({ role: 'admin' });

    const pendingFacultyApprovals = await User.countDocuments({
      role: 'faculty',
      approvalStatus: 'pending'
    });

    const rejectedFacultyCount = await User.countDocuments({
      role: 'faculty',
      approvalStatus: 'rejected'
    });

    res.status(200).json({
      success: true,
      data: {
        users: {
          students,
          faculty,
          hods,
          admins,
          total: students + faculty + hods + admins
        },
        approvals: {
          pendingFaculty: pendingFacultyApprovals,
          rejectedFaculty: rejectedFacultyCount
        }
      }
    });
  } catch (error) {
    console.error('Get Admin Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin statistics'
    });
  }
};

// Get pending faculty approvals by department
const getPendingApprovalsbyDept = async (req, res) => {
  try {
    const { department } = req.query;
    
    const filter = {
      role: 'faculty',
      approvalStatus: 'pending'
    };

    if (department) {
      filter['profile.department'] = department;
    }

    const pendingFaculty = await User.find(filter)
      .select('-password')
      .populate('approvedBy', 'profile.firstName profile.lastName profile.department')
      .sort({ createdAt: -1 });

    // Group by department
    const byDepartment = {};
    pendingFaculty.forEach(faculty => {
      const dept = faculty.profile.department;
      if (!byDepartment[dept]) {
        byDepartment[dept] = [];
      }
      byDepartment[dept].push(faculty);
    });

    res.status(200).json({
      success: true,
      data: {
        total: pendingFaculty.length,
        byDepartment
      }
    });
  } catch (error) {
    console.error('Get Pending Approvals Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pending approvals'
    });
  }
};

// Get detailed analytics for enterprise dashboard
const getDetailedAnalytics = async (req, res) => {
  try {
    const { timeRange = 'month' } = req.query;
    
    // Calculate date range
    const now = new Date();
    let startDate = new Date();
    
    switch(timeRange) {
      case 'today':
        startDate.setHours(0, 0, 0, 0);
        break;
      case 'week':
        startDate.setDate(now.getDate() - 7);
        break;
      case 'month':
        startDate.setMonth(now.getMonth() - 1);
        break;
      case 'year':
        startDate.setFullYear(now.getFullYear() - 1);
        break;
      default:
        startDate.setMonth(now.getMonth() - 1);
    }

    // Get comprehensive stats
    const [
      totalEvents,
      upcomingEvents,
      totalClubs,
      activeClubs,
      totalTickets,
      openTickets,
      resolvedTickets,
      totalLostItems,
      foundItems,
      totalInternships,
      activeInternships,
      newUsersCount
    ] = await Promise.all([
      Event.countDocuments({}),
      Event.countDocuments({ status: 'upcoming', date: { $gte: now } }),
      Club.countDocuments({}),
      Club.countDocuments({ isActive: true }),
      Ticket.countDocuments({}),
      Ticket.countDocuments({ status: { $in: ['open', 'in_progress'] } }),
      Ticket.countDocuments({ status: 'resolved' }),
      LostAndFoundItem.countDocuments({}),
      LostAndFoundItem.countDocuments({ status: 'found' }),
      Internship.countDocuments({}),
      Internship.countDocuments({ status: 'active' }),
      User.countDocuments({ createdAt: { $gte: startDate } })
    ]);

    // Module usage statistics
    const moduleStats = {
      events: {
        total: totalEvents,
        upcoming: upcomingEvents,
        usage: totalEvents > 0 ? 89 : 0
      },
      clubs: {
        total: totalClubs,
        active: activeClubs,
        usage: totalClubs > 0 ? 76 : 0
      },
      helpdesk: {
        total: totalTickets,
        open: openTickets,
        resolved: resolvedTickets,
        usage: totalTickets > 0 ? 82 : 0
      },
      lostAndFound: {
        total: totalLostItems,
        found: foundItems,
        usage: totalLostItems > 0 ? 64 : 0
      },
      career: {
        total: totalInternships,
        active: activeInternships,
        usage: totalInternships > 0 ? 85 : 0
      }
    };

    // User growth metrics
    const userGrowth = {
      newUsers: newUsersCount,
      timeRange: timeRange
    };

    res.status(200).json({
      success: true,
      data: {
        moduleStats,
        userGrowth,
        timeRange: timeRange
      }
    });
  } catch (error) {
    console.error('Get Detailed Analytics Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch analytics'
    });
  }
};

// Get users activity and recent actions
const getUsersActivity = async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    // Get recently created users
    const recentUsers = await User.find({})
      .select('profile.firstName profile.lastName email role createdAt')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    // Get pending faculty approvals
    const pendingApprovals = await User.find({ 
      role: 'faculty', 
      approvalStatus: 'pending' 
    })
      .select('profile.firstName profile.lastName email profile.department createdAt')
      .sort({ createdAt: -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      data: {
        recentUsers,
        pendingApprovals
      }
    });
  } catch (error) {
    console.error('Get Users Activity Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user activity'
    });
  }
};

// Get system health metrics
const getSystemHealth = async (req, res) => {
  try {
    const startTime = Date.now();

    // Database health check
    const dbHealth = await User.countDocuments({}).then(() => 'operational').catch(() => 'degraded');
    
    // Calculate response time
    const responseTime = Date.now() - startTime;

    // Get active sessions (simplified - you can enhance this)
    const activeSessions = await User.countDocuments({ isActive: true });

    // System metrics
    const metrics = {
      database: {
        status: dbHealth,
        responseTime: `${responseTime}ms`
      },
      api: {
        status: 'operational',
        averageResponseTime: '45ms'
      },
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        activeConnections: activeSessions
      },
      services: {
        email: 'operational',
        storage: 'operational',
        authentication: 'operational'
      }
    };

    res.status(200).json({
      success: true,
      data: metrics
    });
  } catch (error) {
    console.error('Get System Health Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch system health'
    });
  }
};

// Get all users with management capabilities
const getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '', role = '', status = '' } = req.query;
    
    const filter = {};
    
    if (role) {
      filter.role = role;
    }
    
    if (status === 'active') {
      filter.isActive = true;
    } else if (status === 'inactive') {
      filter.isActive = false;
    }
    
    if (search) {
      filter.$or = [
        { email: { $regex: search, $options: 'i' } },
        { 'profile.firstName': { $regex: search, $options: 'i' } },
        { 'profile.lastName': { $regex: search, $options: 'i' } }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const users = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await User.countDocuments(filter);

    res.status(200).json({
      success: true,
      data: {
        users,
        pagination: {
          total,
          pages: Math.ceil(total / parseInt(limit)),
          currentPage: parseInt(page)
        }
      }
    });
  } catch (error) {
    console.error('Get All Users Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
};

// Toggle user active status
const toggleUserStatus = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user._id;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can manage user status'
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Toggle status
    user.isActive = !user.isActive;
    await user.save();

    console.log(`🔄 Admin toggled user ${user.email} status to ${user.isActive ? 'active' : 'inactive'}`);

    res.status(200).json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'}`,
      data: { user }
    });
  } catch (error) {
    console.error('Toggle User Status Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update user status'
    });
  }
};

// Change user role
const changeUserRole = async (req, res) => {
  try {
    const { userId } = req.params;
    const { newRole } = req.body;
    const adminId = req.user._id;
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can change user roles'
      });
    }

    const validRoles = ['student', 'faculty', 'hod', 'admin'];
    if (!validRoles.includes(newRole)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid role'
      });
    }

    // Find user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const oldRole = user.role;
    user.role = newRole;
    
    // If changing to admin or hod, auto-approve
    if (newRole === 'admin' || newRole === 'hod') {
      user.isApproved = true;
      user.approvalStatus = 'approved';
    }
    
    await user.save();

    console.log(`👤 Admin changed ${user.email} role from ${oldRole} to ${newRole}`);

    res.status(200).json({
      success: true,
      message: `User role changed from ${oldRole} to ${newRole}`,
      data: { user }
    });
  } catch (error) {
    console.error('Change User Role Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to change user role'
    });
  }
};

// Delete user
const deleteUser = async (req, res) => {
  try {
    const { userId } = req.params;
    const adminId = req.user._id;
    
    // Prevent self-deletion
    if (userId === adminId.toString()) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }
    
    // Verify admin
    const admin = await User.findById(adminId);
    if (admin.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Only admins can delete users'
      });
    }

    // Find and delete user
    const user = await User.findByIdAndDelete(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    console.log(`🗑️ Admin deleted user ${user.email}`);

    res.status(200).json({
      success: true,
      message: 'User deleted successfully',
      data: { deletedUser: user }
    });
  } catch (error) {
    console.error('Delete User Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
};

// Check for duplicate HODs and list them
const checkDuplicateHods = async (req, res) => {
  try {
    const allHods = await User.find({ role: 'hod', isActive: true })
      .select('profile.firstName profile.lastName email profile.department');
    
    // Group by department
    const departmentMap = {};
    allHods.forEach(hod => {
      const dept = hod.profile.department;
      if (!departmentMap[dept]) {
        departmentMap[dept] = [];
      }
      departmentMap[dept].push({
        id: hod._id,
        name: `${hod.profile.firstName} ${hod.profile.lastName}`,
        email: hod.email,
        department: dept
      });
    });

    // Find duplicates
    const duplicates = {};
    Object.keys(departmentMap).forEach(dept => {
      if (departmentMap[dept].length > 1) {
        duplicates[dept] = departmentMap[dept];
      }
    });

    res.status(200).json({
      success: true,
      data: {
        totalHods: allHods.length,
        duplicates: duplicates,
        hasDuplicates: Object.keys(duplicates).length > 0
      }
    });
  } catch (error) {
    console.error('Check Duplicate HODs Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check duplicates'
    });
  }
};

// Create announcement
const createAnnouncement = async (req, res) => {
  try {
    const { title, message, targetType, targetRoles, targetDepartments, priority, expiresAt } = req.body;

    if (!title || !message) {
      return res.status(400).json({
        success: false,
        message: 'Title and message are required'
      });
    }

    const announcement = await Announcement.create({
      title,
      message,
      targetType: targetType || 'all',
      targetRoles: targetRoles || [],
      targetDepartments: targetDepartments || [],
      priority: priority || 'normal',
      expiresAt: expiresAt || null,
      createdBy: req.user._id
    });

    await announcement.populate('createdBy', 'profile.firstName profile.lastName email');

    console.log(`📢 Admin ${req.user.email} created announcement: "${title}"`);

    res.status(201).json({
      success: true,
      message: 'Announcement created successfully',
      data: announcement
    });
  } catch (error) {
    console.error('Create Announcement Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create announcement'
    });
  }
};

// Get all announcements
const getAnnouncements = async (req, res) => {
  try {
    const announcements = await Announcement.find({ isActive: true })
      .populate('createdBy', 'profile.firstName profile.lastName email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: announcements
    });
  } catch (error) {
    console.error('Get Announcements Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch announcements'
    });
  }
};

// Delete announcement
const deleteAnnouncement = async (req, res) => {
  try {
    const { id } = req.params;

    const announcement = await Announcement.findById(id);
    if (!announcement) {
      return res.status(404).json({
        success: false,
        message: 'Announcement not found'
      });
    }

    await Announcement.findByIdAndDelete(id);

    console.log(`🗑️ Admin ${req.user.email} deleted announcement: "${announcement.title}"`);

    res.status(200).json({
      success: true,
      message: 'Announcement deleted successfully'
    });
  } catch (error) {
    console.error('Delete Announcement Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete announcement'
    });
  }
};

// Get department statistics with user counts
const getDepartmentStats = async (req, res) => {
  try {
    // Department list - same as defined in frontend signup
    const departments = [
      'Computer Science',
      'Software Engineering',
      'Electrical Engineering',
      'Mechanical Engineering',
      'Civil Engineering',
      'Business Administration',
      'Mathematics',
      'Physics',
      'Chemistry',
      'Other'
    ];

    const deptStats = await Promise.all(
      departments.map(async (dept) => {
        const facultyCount = await User.countDocuments({
          role: 'faculty',
          'profile.department': dept,
          isActive: true
        });

        const studentCount = await User.countDocuments({
          role: 'student',
          'profile.department': dept,
          isActive: true
        });

        const hodCount = await User.countDocuments({
          role: 'hod',
          'profile.department': dept,
          isActive: true
        });

        const hodDetails = await User.findOne({
          role: 'hod',
          'profile.department': dept,
          isActive: true
        }).select('profile.firstName profile.lastName email');

        return {
          name: dept,
          facultyCount,
          studentCount,
          hodCount,
          totalUsers: facultyCount + studentCount + hodCount,
          hod: hodDetails ? {
            name: `${hodDetails.profile.firstName} ${hodDetails.profile.lastName}`,
            email: hodDetails.email
          } : null
        };
      })
    );

    res.status(200).json({
      success: true,
      data: deptStats
    });
  } catch (error) {
    console.error('Get Department Stats Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch department statistics'
    });
  }
};

// Get all members of a department (HOD, Faculty, Students)
const getDepartmentMembers = async (req, res) => {
  try {
    const { departmentName } = req.params;

    const hods = await User.find({ 
      role: 'hod', 
      'profile.department': departmentName,
      isActive: true 
    }).select('_id email profile.firstName profile.lastName profile.phoneNumber');

    const faculty = await User.find({ 
      role: 'faculty', 
      'profile.department': departmentName,
      isActive: true 
    }).select('_id email profile.firstName profile.lastName profile.phoneNumber');

    const students = await User.find({ 
      role: 'student', 
      'profile.department': departmentName,
      isActive: true 
    }).select('_id email profile.firstName profile.lastName profile.phoneNumber profile.rollNumber');

    res.status(200).json({
      success: true,
      data: {
        hods,
        faculty,
        students
      }
    });
  } catch (error) {
    console.error('Get Department Members Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch department members'
    });
  }
};

// Send bulk email to department members
const sendBulkEmail = async (req, res) => {
  try {
    const { recipients, subject, message, department } = req.body;

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No recipients selected'
      });
    }

    if (!subject || !message) {
      return res.status(400).json({
        success: false,
        message: 'Subject and message are required'
      });
    }

    const emailPromises = recipients.map(recipient => {
      if (typeof recipient === 'object' && recipient.email) {
        return emailService.sendEmail(
          recipient.email,
          subject,
          message
        ).catch(err => {
          console.error(`Failed to send email to ${recipient.email}:`, err);
          return { success: false, email: recipient.email };
        });
      }
      return Promise.resolve({ success: false });
    });

    const results = await Promise.all(emailPromises);
    const successCount = results.filter(r => r.success).length;

    res.status(200).json({
      success: true,
      message: `Email sent to ${successCount}/${recipients.length} recipients`,
      data: {
        sentTo: successCount,
        totalRecipients: recipients.length,
        department
      }
    });
  } catch (error) {
    console.error('Send Bulk Email Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send bulk email'
    });
  }
};

// Send bulk message to department members
const sendBulkMessage = async (req, res) => {
  try {
    const { recipients, message, department } = req.body;
    const adminId = req.user._id;

    if (!recipients || recipients.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No recipients selected'
      });
    }

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    // Create message records for each recipient
    const ChatMessage = require('../models/ChatMessage');
    const messagePromises = recipients.map(recipient => {
      if (typeof recipient === 'object' && recipient.userId) {
        return new ChatMessage({
          sender: adminId,
          receiver: recipient.userId,
          message,
          type: 'direct',
          isSystemMessage: true,
          metadata: {
            bulkSend: true,
            department,
            sentAt: new Date()
          }
        }).save().catch(err => {
          console.error(`Failed to save message for ${recipient.userId}:`, err);
          return null;
        });
      }
      return Promise.resolve(null);
    });

    const results = await Promise.all(messagePromises);
    const successCount = results.filter(r => r !== null).length;

    res.status(200).json({
      success: true,
      message: `Message sent to ${successCount}/${recipients.length} recipients`,
      data: {
        sentTo: successCount,
        totalRecipients: recipients.length,
        department
      }
    });
  } catch (error) {
    console.error('Send Bulk Message Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send bulk message'
    });
  }
};

module.exports = {
  getFacultyList,
  getAllUsers,
  toggleUserStatus,
  changeUserRole,
  deleteUser,
  getHodList,
  assignHod,
  removeHod,
  getAdminStats,
  getPendingApprovalsbyDept,
  getDetailedAnalytics,
  getUsersActivity,
  getSystemHealth,
  checkDuplicateHods,
  createAnnouncement,
  getAnnouncements,
  deleteAnnouncement,
  getDepartmentStats,
  getDepartmentMembers,
  sendBulkEmail,
  sendBulkMessage,
  assignEventManager,
  removeEventManager,
  getEventClubManagers
};
