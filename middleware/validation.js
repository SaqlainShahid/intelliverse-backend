// middleware/validation.js - Complete updated file
const joi = require('joi');

const validateSignupData = (req, res, next) => {
  const schema = joi.object({
    email: joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
      }),
    role: joi.string()
      .valid('student', 'faculty', 'admin')
      .required()
      .messages({
        'any.only': 'Role must be student, faculty, or admin',
        'any.required': 'Role is required'
      }),
    profile: joi.object({
      firstName: joi.string().min(2).max(50).required(),
      lastName: joi.string().min(2).max(50).required(),
      phone: joi.string().optional(),
      department: joi.string().min(2).max(100).required(),
      studentId: joi.when(joi.ref('...role'), {
        is: 'student',
        then: joi.string().required(),
        otherwise: joi.forbidden()
      }),
      semester: joi.when(joi.ref('...role'), {
        is: 'student',
        then: joi.number().min(1).max(8).optional(),
        otherwise: joi.forbidden()
      }),
      employeeId: joi.when(joi.ref('...role'), {
        is: joi.valid('faculty', 'admin'),
        then: joi.string().required(),
        otherwise: joi.forbidden()
      }),
      designation: joi.when(joi.ref('...role'), {
        is: joi.valid('faculty', 'admin'),
        then: joi.string().optional(),
        otherwise: joi.forbidden()
      }),
      adminCode: joi.when(joi.ref('...role'), {
        is: 'admin',
        then: joi.string().required(),
        otherwise: joi.forbidden()
      })
    }).required()
  });
  
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message,
      field: error.details[0].path[0]
    });
  }
  next();
};

const validateLoginData = (req, res, next) => {
  const schema = joi.object({
    email: joi.string().email().required(),
    password: joi.string().min(6).required()
  });
  
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message
    });
  }
  next();
};

// validateOTPData is a middleware factory so routes can specify expected purpose
const validateOTPData = (expectedPurpose = null) => {
  return (req, res, next) => {
    const schema = joi.object({
      email: joi.string().email().required(),
      otpCode: joi.string().length(6).required(),
      password: expectedPurpose === 'signup'
        ? joi.string().min(6).required()
        : joi.forbidden(),
      // Allow role and profile when verifying signup OTP
      role: expectedPurpose === 'signup'
        ? joi.string()
            .valid('student', 'faculty', 'admin')
            .required()
        : joi.forbidden(),
      profile: expectedPurpose === 'signup'
        ? joi.object({
            firstName: joi.string().min(2).max(50).required(),
            lastName: joi.string().min(2).max(50).required(),
            phone: joi.string().optional(),
            department: joi.string().min(2).max(100).required(),
            studentId: joi.when(joi.ref('...role'), {
              is: 'student',
              then: joi.string().required(),
              otherwise: joi.forbidden()
            }),
            semester: joi.when(joi.ref('...role'), {
              is: 'student',
              then: joi.number().min(1).max(8).optional(),
              otherwise: joi.forbidden()
            }),
            employeeId: joi.when(joi.ref('...role'), {
              is: joi.valid('faculty', 'admin'),
              then: joi.string().required(),
              otherwise: joi.forbidden()
            }),
            designation: joi.when(joi.ref('...role'), {
              is: joi.valid('faculty', 'admin'),
              then: joi.string().optional(),
              otherwise: joi.forbidden()
            }),
            adminCode: joi.when(joi.ref('...role'), {
              is: 'admin',
              then: joi.string().required(),
              otherwise: joi.forbidden()
            })
          }).required()
        : joi.forbidden(),
      deviceInfo: joi.object({
        deviceId: joi.string().optional(),
        deviceType: joi.string().valid('mobile', 'web', 'desktop').default('web'),
        userAgent: joi.string().optional()
      }).optional()
    });

    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message
      });
    }
    next();
  };
};

// NEW: Validate email for forgot password
const validateEmailData = (req, res, next) => {
  const schema = joi.object({
    email: joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
      })
  });
  
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message
    });
  }
  next();
};

// NEW: Validate forgot password OTP data
const validateForgotPasswordOTPData = (req, res, next) => {
  const schema = joi.object({
    email: joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
      }),
    otpCode: joi.string()
      .length(6)
      .pattern(/^[0-9]+$/)
      .required()
      .messages({
        'string.length': 'Reset code must be exactly 6 digits',
        'string.pattern.base': 'Reset code must contain only numbers',
        'any.required': 'Reset code is required'
      })
  });
  
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message
    });
  }
  next();
};

// NEW: Validate password reset data
const validatePasswordResetData = (req, res, next) => {
  const schema = joi.object({
    email: joi.string()
      .email({ tlds: { allow: false } })
      .required()
      .messages({
        'string.email': 'Please provide a valid email address',
        'any.required': 'Email is required'
      }),
    otpCode: joi.string()
      .length(6)
      .pattern(/^[0-9]+$/)
      .required()
      .messages({
        'string.length': 'Reset code must be exactly 6 digits',
        'string.pattern.base': 'Reset code must contain only numbers',
        'any.required': 'Reset code is required'
      }),
    newPassword: joi.string()
      .min(6)
      .max(128)
      .required()
      .messages({
        'string.min': 'Password must be at least 6 characters long',
        'string.max': 'Password must be less than 128 characters',
        'any.required': 'New password is required'
      })
  });
  
  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message
    });
  }
  next();
};

// HelpDesk validation schemas
const validateTicket = (req, res, next) => {
  const schema = joi.object({
    title: joi.string()
      .min(5)
      .max(200)
      .required()
      .messages({
        'string.min': 'Title must be at least 5 characters long',
        'string.max': 'Title cannot exceed 200 characters',
        'any.required': 'Title is required'
      }),
    description: joi.string()
      .min(10)
      .max(2000)
      .required()
      .messages({
        'string.min': 'Description must be at least 10 characters long',
        'string.max': 'Description cannot exceed 2000 characters',
        'any.required': 'Description is required'
      }),
    category: joi.string()
      .valid('academic', 'administrative', 'it_support', 'facilities', 'financial', 'library', 'transportation', 'other')
      .required()
      .messages({
        'any.only': 'Invalid category',
        'any.required': 'Category is required'
      }),
    subcategory: joi.string()
      .max(100)
      .optional(),
    priority: joi.string()
      .valid('low', 'medium', 'high', 'urgent')
      .default('medium'),
    department: joi.string()
      .min(2)
      .max(100)
      .required()
      .messages({
        'string.min': 'Department must be at least 2 characters long',
        'string.max': 'Department cannot exceed 100 characters',
        'any.required': 'Department is required'
      }),
    tags: joi.array()
      .items(joi.string().max(50))
      .max(10)
      .optional(),
    status: joi.string()
      .valid('open', 'in_progress', 'pending_user', 'resolved', 'closed', 'cancelled')
      .optional(),
    assignedTo: joi.string()
      .pattern(/^[0-9a-fA-F]{24}$/)
      .optional()
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message,
      field: error.details[0].path[0]
    });
  }
  next();
};

const validateComment = (req, res, next) => {
  const schema = joi.object({
    message: joi.string()
      .min(1)
      .max(1000)
      .required()
      .messages({
        'string.min': 'Comment cannot be empty',
        'string.max': 'Comment cannot exceed 1000 characters',
        'any.required': 'Comment message is required'
      }),
    isInternal: joi.boolean()
      .default(false)
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message,
      field: error.details[0].path[0]
    });
  }
  next();
};

const validateFeedback = (req, res, next) => {
  const schema = joi.object({
    rating: joi.number()
      .integer()
      .min(1)
      .max(5)
      .required()
      .messages({
        'number.min': 'Rating must be at least 1',
        'number.max': 'Rating cannot exceed 5',
        'any.required': 'Rating is required'
      }),
    comment: joi.string()
      .max(500)
      .optional()
      .messages({
        'string.max': 'Feedback comment cannot exceed 500 characters'
      })
  });

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message,
      field: error.details[0].path[0]
    });
  }
  next();
};

module.exports = {
  validateSignupData,
  validateLoginData,
  validateOTPData,
  // Add new validators
  validateEmailData,
  validateForgotPasswordOTPData,
  validatePasswordResetData,
  // HelpDesk validators
  validateTicket,
  validateComment,
  validateFeedback,
  validateTicketUpdate: (req, res, next) => {
    const schema = joi.object({
      title: joi.string().min(5).max(200).optional(),
      description: joi.string().min(10).max(2000).optional(),
      category: joi.string().valid('academic','administrative','it_support','facilities','financial','library','transportation','other').optional(),
      subcategory: joi.string().max(100).optional(),
      priority: joi.string().valid('low','medium','high','urgent').optional(),
      department: joi.string().min(2).max(100).optional(),
      tags: joi.array().items(joi.string().max(50)).max(10).optional(),
      status: joi.string().valid('open','in_progress','pending_user','resolved','closed','cancelled').optional(),
      assignedTo: joi.string().pattern(/^[0-9a-fA-F]{24}$/).optional()
    });
    const { error } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: error.details[0].message,
        field: error.details[0].path[0]
      });
    }
    next();
  }
};
