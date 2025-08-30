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
        is: 'faculty',
        then: joi.string().required(),
        otherwise: joi.forbidden()
      }),
      designation: joi.when(joi.ref('...role'), {
        is: 'faculty',
        then: joi.string().optional(),
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
              is: 'faculty',
              then: joi.string().required(),
              otherwise: joi.forbidden()
            }),
            designation: joi.when(joi.ref('...role'), {
              is: 'faculty',
              then: joi.string().optional(),
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

module.exports = {
  validateSignupData,
  validateLoginData,
  validateOTPData,
  // Add new validators
  validateEmailData,
  validateForgotPasswordOTPData,
  validatePasswordResetData
};