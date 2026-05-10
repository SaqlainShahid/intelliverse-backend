const { verifyAccessToken } = require('../utils/jwtUtils');
const User = require('../models/User');

const isCentralApprover = (user) => {
  if (!user) return false;
  return !!user.isEventClubManager;
};

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'Access token is required'
      });
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
    const decoded = verifyAccessToken(token);
    const user = await User.findById(decoded.userId);
    
    if (!user || !user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token or user not found'
      });
    }
    
    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// Role-based authorization
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }
    
    next();
  };
};

const requireCentralApprover = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }
  if (!isCentralApprover(req.user)) {
    return res.status(403).json({
      success: false,
      message: 'Only the designated approver can perform this action'
    });
  }
  next();
};

// Check if faculty is approved (prevents unapproved faculty from accessing protected routes)
const checkFacultyApproval = async (req, res, next) => {
  try {
    if (req.user && req.user.role === 'faculty' && !req.user.isApproved) {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending HOD approval. Please contact your department HOD.',
        approvalStatus: req.user.approvalStatus
      });
    }
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error checking faculty approval status'
    });
  }
};

// Department-based authorization (for HOD operations)
const authorizeDepartment = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  // HODs can only access their own department, admins can access all
  if (req.user.role === 'hod') {
    req.departmentFilter = req.user.profile.department;
  } else if (req.user.role === 'admin') {
    req.departmentFilter = null; // null means all departments
  } else {
    return res.status(403).json({
      success: false,
      message: 'Insufficient permissions'
    });
  }

  next();
};

const tryAuthenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyAccessToken(token);
      const user = await User.findById(decoded.userId);
      if (user && user.isActive) {
        req.user = user;
      }
    }
  } catch (e) {}
  next();
};

module.exports = {
  authenticate,
  authorize,
  checkFacultyApproval,
  authorizeDepartment,
  tryAuthenticate,
  isCentralApprover,
  requireCentralApprover
};
