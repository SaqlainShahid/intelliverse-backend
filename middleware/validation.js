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

module.exports = {
  validateSignupData,
  validateLoginData,
  validateOTPData
};