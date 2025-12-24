// utils/emailService.js - Corrected file
const nodemailer = require('nodemailer');
const User = require('../models/User');

// Create transporter - FIXED: createTransport (not createTransporter)
const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: process.env.EMAIL_PORT,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  },
  tls: {
    rejectUnauthorized: false
  }
});

// Verify email configuration
const verifyEmailConfig = async () => {
  try {
    await transporter.verify();
    console.log('✅ Email service is ready');
    return true;
  } catch (error) {
    console.error('❌ Email service error:', error.message);
    return false;
  }
};

// Signup email template
const getSignupEmailTemplate = (otpCode, firstName) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Welcome to IntelliVerse</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 28px;">🎓 Welcome to IntelliVerse</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px;">Smart Campus Companion</p>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
        <h2 style="color: #333; margin-bottom: 20px;">Hello ${firstName}!</h2>
        <p style="margin-bottom: 20px;">Welcome to IntelliVerse! Please verify your account with the code below:</p>
        
        <div style="background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-size: 14px;">Your Verification Code:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px;">${otpCode}</div>
        </div>
        
        <p><strong>Important:</strong></p>
        <ul>
          <li>This code will expire in 15 minutes</li>
          <li>Don't share this code with anyone</li>
          <li>If you didn't request this, please ignore this email</li>
        </ul>
        
        <p>Welcome to the future of campus life! 🚀</p>
      </div>
      
      <div style="text-align: center; margin-top: 20px; color: #666; font-size: 14px;">
        <p>&copy; 2025 IntelliVerse - Air University Islamabad</p>
        <p>This is an automated message, please do not reply.</p>
      </div>
    </body>
    </html>
  `;
};

// Login email template
const getLoginEmailTemplate = (otpCode, firstName) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Login Verification - IntelliVerse</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 28px;">🔐 Login Verification</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px;">IntelliVerse Smart Campus</p>
      </div>
      
      <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
        <h2 style="color: #333; margin-bottom: 20px;">Hello ${firstName}!</h2>
        <p style="margin-bottom: 20px;">Someone is trying to login to your IntelliVerse account. Use the code below to complete the login:</p>
        
        <div style="background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 10px 0; font-size: 14px;">Your Login Code:</p>
          <div style="font-size: 32px; font-weight: bold; letter-spacing: 4px;">${otpCode}</div>
        </div>
        
        <p><strong>Security Notice:</strong></p>
        <ul>
          <li>This code will expire in 15 minutes</li>
          <li>If this wasn't you, please change your password immediately</li>
          <li>Never share this code with anyone</li>
        </ul>
      </div>
      
      <div style="text-align: center; margin-top: 20px; color: #666; font-size: 14px;">
        <p>&copy; 2025 IntelliVerse - Air University Islamabad</p>
        <p>This is an automated message, please do not reply.</p>
      </div>
    </body>
    </html>
  `;
};

// Forgot password email template
const getForgotPasswordEmailTemplate = (otpCode, firstName) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset - IntelliVerse</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
        <h1 style="color: white; margin: 0; font-size: 28px;">🔐 Password Reset</h1>
        <p style="color: #f0f0f0; margin: 10px 0 0 0; font-size: 16px;">IntelliVerse Smart Campus</p>
      </div>
      
      <div style="background: #ffffff; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
        <h2 style="color: #333; margin-bottom: 20px;">Hello ${firstName || 'User'}!</h2>
        
        <p style="margin-bottom: 20px; font-size: 16px;">
          We received a request to reset your password for your IntelliVerse account. 
        </p>
        
        <div style="background: #f8f9fa; border: 2px solid #e9ecef; border-radius: 8px; padding: 20px; text-align: center; margin: 25px 0;">
          <p style="margin: 0 0 10px 0; font-size: 14px; color: #666;">Your Password Reset Code:</p>
          <h1 style="font-size: 36px; font-weight: bold; color: #495057; letter-spacing: 8px; margin: 0;">${otpCode}</h1>
        </div>
        
        <div style="background: #fff3cd; border: 1px solid #ffeaa7; border-radius: 6px; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #856404;">
            ⚠️ <strong>Security Notice:</strong> This code will expire in 15 minutes. 
            If you didn't request this password reset, please ignore this email and your password will remain unchanged.
          </p>
        </div>
        
        <p style="margin: 20px 0; font-size: 14px; color: #666;">
          Enter this code in the IntelliVerse app to continue with your password reset.
        </p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        
        <p style="font-size: 12px; color: #888; text-align: center; margin: 0;">
          This is an automated message from IntelliVerse Smart Campus System.<br>
          If you have any questions, please contact your system administrator.
        </p>
      </div>
    </body>
    </html>
  `;
};

// Updated sendOTPEmail function to handle all purposes
const sendOTPEmail = async (email, otpCode, purpose, firstName = 'User') => {
  try {
    let subject, htmlContent;
    
    switch (purpose) {
      case 'signup':
        subject = '🎓 Welcome to IntelliVerse - Verify Your Account';
        htmlContent = getSignupEmailTemplate(otpCode, firstName);
        break;
      case 'login':
        subject = '🔐 IntelliVerse Login Verification';
        htmlContent = getLoginEmailTemplate(otpCode, firstName);
        break;
      case 'forgot-password':
        subject = '🔑 Reset Your IntelliVerse Password';
        htmlContent = getForgotPasswordEmailTemplate(otpCode, firstName);
        break;
      default:
        // Fallback to your existing template
        subject = purpose === 'signup' ? 
          'Welcome to IntelliVerse - Verify Your Account' : 
          'IntelliVerse Login Verification';
        htmlContent = `
          <!DOCTYPE html>
          <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>IntelliVerse OTP</title>
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
              .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px; }
              .otp-box { background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0; }
              .otp-code { font-size: 32px; font-weight: bold; letter-spacing: 4px; }
              .footer { text-align: center; margin-top: 20px; color: #666; font-size: 14px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>🎓 IntelliVerse</h1>
                <p>Smart Campus Companion</p>
              </div>
              <div class="content">
                <h2>Hello ${firstName}!</h2>
                <p>Your verification code for ${purpose === 'signup' ? 'account registration' : 'login'} is:</p>
                
                <div class="otp-box">
                  <div class="otp-code">${otpCode}</div>
                </div>
                
                <p><strong>Important:</strong></p>
                <ul>
                  <li>This code will expire in 15 minutes</li>
                  <li>Don't share this code with anyone</li>
                  <li>If you didn't request this, please ignore this email</li>
                </ul>
                
                <p>Welcome to the future of campus life! 🚀</p>
              </div>
              <div class="footer">
                <p>&copy; 2025 IntelliVerse - Air University Islamabad</p>
                <p>This is an automated message, please do not reply.</p>
              </div>
            </div>
          </body>
          </html>
        `;
    }
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: email,
      subject: subject,
      html: htmlContent
    };
    
    await transporter.sendMail(mailOptions);
    
    console.log(`✅ ${purpose} email sent successfully to: ${email}`);
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Email sending failed for ${purpose}:`, error);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

// Add Lost & Found Item Found Notification Email Template (before module.exports)
const getItemFoundEmailTemplate = (ownerName, itemName, itemDescription, location, finderName, finderEmail, finderPhone) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Your Lost Item Has Been Found!</title>
    </head>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
        <h1 style="margin: 0; font-size: 28px;">🎉 Great News!</h1>
        <p style="margin: 10px 0 0 0; font-size: 16px;">Your Lost Item Has Been Found</p>
      </div>
      
      <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 8px 8px;">
        <h2 style="color: #333; margin-bottom: 20px;">Hello ${ownerName}!</h2>
        
        <p style="margin-bottom: 20px; font-size: 16px;">
          We have great news! Someone has found your lost item on campus.
        </p>
        
        <div style="background: #ffffff; border-left: 4px solid #10b981; padding: 20px; margin: 20px 0; border-radius: 4px;">
          <h3 style="margin: 0 0 15px 0; color: #10b981;">📦 Item Details:</h3>
          <p style="margin: 5px 0;"><strong>Item Name:</strong> ${itemName}</p>
          <p style="margin: 5px 0;"><strong>Description:</strong> ${itemDescription}</p>
          <p style="margin: 5px 0;"><strong>Last Known Location:</strong> ${location}</p>
        </div>
        
        <div style="background: #eff6ff; border: 1px solid #3b82f6; border-radius: 8px; padding: 20px; margin: 20px 0;">
          <h3 style="margin: 0 0 15px 0; color: #1e40af;">👤 Finder Information:</h3>
          <p style="margin: 5px 0;"><strong>Name:</strong> ${finderName}</p>
          <p style="margin: 5px 0;"><strong>Email:</strong> <a href="mailto:${finderEmail}" style="color: #2563eb;">${finderEmail}</a></p>
          ${finderPhone ? `<p style="margin: 5px 0;"><strong>Phone:</strong> ${finderPhone}</p>` : ''}
        </div>
        
        <div style="background: #fef3c7; border: 1px solid #f59e0b; border-radius: 6px; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; font-size: 14px; color: #92400e;">
            ⚠️ <strong>Next Steps:</strong><br>
            Please contact the finder directly to arrange the collection of your item. 
            Remember to verify that the item is indeed yours before claiming it.
          </p>
        </div>
        
        <p style="margin-top: 20px;">
          To claim your item, please log in to IntelliVerse and click the "Claim My Item" button on the item card.
        </p>
        
        <p style="margin-top: 30px; color: #666; font-size: 14px;">
          Thank you for using IntelliVerse Lost & Found! 🙏
        </p>
      </div>
      
      <div style="text-align: center; margin-top: 20px; color: #666; font-size: 14px;">
        <p>&copy; 2025 IntelliVerse - Air University Islamabad</p>
        <p>This is an automated message, please do not reply.</p>
      </div>
    </body>
    </html>
  `;
};

// Send Item Found Notification Email
const sendItemFoundNotification = async (ownerEmail, itemDetails, finderDetails) => {
  try {
    const subject = '🎉 Great News! Your Lost Item Has Been Found - IntelliVerse';
    const htmlContent = getItemFoundEmailTemplate(
      itemDetails.ownerName,
      itemDetails.itemName,
      itemDetails.description,
      itemDetails.location,
      finderDetails.name,
      finderDetails.email,
      finderDetails.phone || 'Not provided'
    );
    
    const mailOptions = {
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to: ownerEmail,
      subject: subject,
      html: htmlContent
    };
    
    await transporter.sendMail(mailOptions);
    
    console.log(`✅ Item found notification email sent successfully to: ${ownerEmail}`);
    return { success: true };
    
  } catch (error) {
    console.error(`❌ Item found email sending failed:`, error);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

// HelpDesk email templates and functions
const getTicketNotificationTemplate = (type, ticket, user) => {
  const statusColors = {
    'open': '#10B981',
    'in_progress': '#F59E0B',
    'pending_user': '#8B5CF6',
    'resolved': '#059669',
    'closed': '#6B7280',
    'cancelled': '#EF4444'
  };

  const priorityColors = {
    'low': '#10B981',
    'medium': '#F59E0B',
    'high': '#EF4444',
    'urgent': '#DC2626'
  };

  let subject = '';
  let title = '';
  let message = '';

  switch (type) {
    case 'new_ticket':
      subject = `New HelpDesk Ticket: ${ticket.ticketNumber}`;
      title = '🎫 New Ticket Created';
      message = `A new ticket has been created and requires attention.`;
      break;
    case 'status_update':
      subject = `Ticket Update: ${ticket.ticketNumber} - Status Changed`;
      title = '📋 Ticket Status Updated';
      message = `Your ticket status has been updated to <strong>${ticket.status.replace('_', ' ').toUpperCase()}</strong>.`;
      break;
    case 'new_comment':
      subject = `New Comment on Ticket: ${ticket.ticketNumber}`;
      title = '💬 New Comment Added';
      message = `A new comment has been added to your ticket.`;
      break;
    case 'assignment':
      subject = `Ticket Assigned: ${ticket.ticketNumber}`;
      title = '👤 Ticket Assigned';
      message = `This ticket has been assigned to you for resolution.`;
      break;
    default:
      subject = `HelpDesk Update: ${ticket.ticketNumber}`;
      title = '📧 HelpDesk Notification';
      message = `You have received an update regarding your ticket.`;
  }

  return {
    subject,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${subject}</title>
      </head>
      <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: #4F46E5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
          <h1 style="margin: 0; font-size: 28px;">🎓 IntelliVerse HelpDesk</h1>
          <p style="margin: 10px 0 0 0; font-size: 16px;">Smart Campus Support</p>
        </div>
        
        <div style="background: #f9f9f9; padding: 30px; border-radius: 0 0 8px 8px;">
          <h2 style="color: #333; margin-bottom: 20px;">${title}</h2>
          <p style="margin-bottom: 20px;">${message}</p>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #4F46E5;">
            <h3 style="margin-top: 0; color: #333;">Ticket Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold; width: 120px;">Ticket #:</td>
                <td style="padding: 8px 0;">${ticket.ticketNumber}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Title:</td>
                <td style="padding: 8px 0;">${ticket.title}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Category:</td>
                <td style="padding: 8px 0; text-transform: capitalize;">${ticket.category.replace('_', ' ')}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Priority:</td>
                <td style="padding: 8px 0;">
                  <span style="background: ${priorityColors[ticket.priority]}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase;">
                    ${ticket.priority}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Status:</td>
                <td style="padding: 8px 0;">
                  <span style="background: ${statusColors[ticket.status]}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 12px; text-transform: uppercase;">
                    ${ticket.status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Created:</td>
                <td style="padding: 8px 0;">${new Date(ticket.createdAt).toLocaleDateString()}</td>
              </tr>
              ${ticket.dueDate ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Due Date:</td>
                <td style="padding: 8px 0;">${new Date(ticket.dueDate).toLocaleDateString()}</td>
              </tr>
              ` : ''}
            </table>
          </div>
          
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">Description</h3>
            <p style="margin: 0; white-space: pre-wrap;">${ticket.description}</p>
          </div>
          
          ${ticket.comments && ticket.comments.length > 0 ? `
          <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">Latest Comments</h3>
            ${ticket.comments.slice(-3).map(comment => `
              <div style="border-left: 3px solid #4F46E5; padding-left: 15px; margin-bottom: 15px;">
                <p style="margin: 0 0 5px 0; font-weight: bold; color: #4F46E5;">
                  ${comment.user.profile.firstName} ${comment.user.profile.lastName}
                  ${comment.isInternal ? '<span style="background: #EF4444; color: white; padding: 2px 6px; border-radius: 3px; font-size: 10px; margin-left: 8px;">INTERNAL</span>' : ''}
                </p>
                <p style="margin: 0; color: #666; font-size: 12px;">
                  ${new Date(comment.createdAt).toLocaleString()}
                </p>
                <p style="margin: 5px 0 0 0; white-space: pre-wrap;">${comment.message}</p>
              </div>
            `).join('')}
          </div>
          ` : ''}
          
          <div style="text-align: center; margin-top: 30px;">
            <a href="${process.env.FRONTEND_URL || 'http://localhost:3000'}/helpdesk/ticket/${ticket._id}" 
               style="background: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
              View Ticket
            </a>
          </div>
          
          <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; text-align: center; color: #666; font-size: 12px;">
            <p>This is an automated notification from IntelliVerse HelpDesk.</p>
            <p>If you have any questions, please contact our support team.</p>
          </div>
        </div>
      </body>
      </html>
    `
  };
};

const sendTicketNotification = async (type, ticket) => {
  try {
    // Determine recipients based on notification type
    let recipients = [];
    
    switch (type) {
      case 'new_ticket':
        // Notify admins and faculty
        const adminsAndFaculty = await User.find({
          role: { $in: ['admin', 'faculty'] },
          isActive: true
        }).select('email profile.firstName profile.lastName');
        recipients = adminsAndFaculty;
        break;
        
      case 'status_update':
      case 'new_comment':
        // Notify ticket reporter and assigned staff
        recipients = [ticket.reportedBy];
        if (ticket.assignedTo && ticket.assignedTo._id.toString() !== ticket.reportedBy._id.toString()) {
          recipients.push(ticket.assignedTo);
        }
        break;
        
      case 'assignment':
        // Notify assigned staff member
        if (ticket.assignedTo) {
          recipients = [ticket.assignedTo];
        }
        break;
    }

    // Send emails to all recipients
    const emailPromises = recipients.map(async (recipient) => {
      const emailTemplate = getTicketNotificationTemplate(type, ticket, recipient);
      
      const mailOptions = {
        from: `"IntelliVerse HelpDesk" <${process.env.EMAIL_USER}>`,
        to: recipient.email,
        subject: emailTemplate.subject,
        html: emailTemplate.html
      };

      return transporter.sendMail(mailOptions);
    });

    await Promise.all(emailPromises);
    
    console.log(`✅ Ticket notification sent successfully for ${type} - ${ticket.ticketNumber}`);
    return { 
      success: true, 
      message: 'Ticket notification sent successfully' 
    };
    
  } catch (error) {
    console.error(`❌ Ticket notification sending failed:`, error);
    return { 
      success: false, 
      error: error.message 
    };
  }
};

// Update module.exports to include new functions
module.exports = {
  sendOTPEmail,
  verifyEmailConfig,
  getForgotPasswordEmailTemplate,
  getSignupEmailTemplate,
  getLoginEmailTemplate,
  getCareerPostingAnnouncementTemplate: (opportunity) => {
    const safe = opportunity || {};
    const deadline = safe.deadline ? new Date(safe.deadline).toLocaleDateString() : 'N/A';
    const typeLabel = safe.type === 'job' ? 'Job' : 'Internship';
    const fixApplyLink = (url) => {
      try {
        if (!url) return '';
        return String(url).replace('/career/admin', '/career');
      } catch {
        return url;
      }
    };
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New ${typeLabel} Approved - IntelliVerse</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; background: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; padding: 24px; }
          .header { background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); color: white; padding: 24px; text-align: center; border-radius: 12px 12px 0 0; }
          .card { background: white; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 6px 16px rgba(0,0,0,0.08); }
          .title { margin: 0; font-size: 22px; color: #111827; }
          .subtitle { margin: 6px 0 0 0; font-size: 14px; color: #e5e7eb; }
          .badge { display: inline-block; padding: 6px 10px; font-size: 12px; border-radius: 999px; background: #eef2ff; color: #3730a3; margin-bottom: 12px; }
          .row { margin: 10px 0; }
          .label { font-size: 12px; color: #6b7280; }
          .value { font-size: 14px; color: #111827; font-weight: 600; }
          .desc { margin: 14px 0; font-size: 14px; color: #374151; white-space: pre-wrap; }
          .cta { display: inline-block; background: #4F46E5; color: white; text-decoration: none; padding: 12px 18px; border-radius: 8px; font-weight: 600; }
          .footer { text-align: center; margin-top: 16px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">New ${typeLabel} Approved</h1>
            <p class="subtitle">IntelliVerse Career Portal</p>
          </div>
          <div class="card">
            <span class="badge">${typeLabel}</span>
            <h2 class="title">${safe.title || 'Opportunity'}</h2>
            <div class="row"><span class="label">Company</span><br /><span class="value">${safe.company || 'N/A'}</span></div>
            <div class="row"><span class="label">Location</span><br /><span class="value">${safe.location || 'N/A'}</span></div>
            <div class="row"><span class="label">Deadline</span><br /><span class="value">${deadline}</span></div>
            ${safe.stipend ? `<div class="row"><span class="label">Compensation</span><br /><span class="value">${safe.stipend}</span></div>` : ''}
            ${safe.eligibility ? `<div class="row"><span class="label">Eligibility</span><br /><span class="value">${safe.eligibility}</span></div>` : ''}
            ${safe.description ? `<div class="desc">${safe.description}</div>` : ''}
            ${safe.applyLink ? `<p><a class="cta" href="${fixApplyLink(safe.applyLink)}" target="_blank" rel="noreferrer">Apply Now</a></p>` : ''}
          </div>
          <div class="footer">
            <p>&copy; 2025 IntelliVerse - Air University Islamabad</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  },
  getCareerPostingStatusTemplate: (opportunity, status) => {
    const safe = opportunity || {};
    const typeLabel = safe.type === 'job' ? 'Job' : 'Internship';
    const fixApplyLink = (url) => {
      try {
        if (!url) return '';
        return String(url).replace('/career/admin', '/career');
      } catch {
        return url;
      }
    };
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${typeLabel} Status Update - IntelliVerse</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; background: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; padding: 24px; }
          .header { background: linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%); color: white; padding: 24px; text-align: center; border-radius: 12px 12px 0 0; }
          .card { background: white; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 6px 16px rgba(0,0,0,0.08); }
          .title { margin: 0; font-size: 22px; color: #111827; }
          .subtitle { margin: 6px 0 0 0; font-size: 14px; color: #e5e7eb; }
          .badge { display: inline-block; padding: 6px 10px; font-size: 12px; border-radius: 999px; background: #eef2ff; color: #3730a3; margin-bottom: 12px; text-transform: capitalize; }
          .row { margin: 10px 0; }
          .label { font-size: 12px; color: #6b7280; }
          .value { font-size: 14px; color: #111827; font-weight: 600; }
          .cta { display: inline-block; background: #4F46E5; color: white; text-decoration: none; padding: 12px 18px; border-radius: 8px; font-weight: 600; }
          .footer { text-align: center; margin-top: 16px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">Opportunity Status Updated</h1>
            <p class="subtitle">IntelliVerse Career Portal</p>
          </div>
          <div class="card">
            <span class="badge">${typeLabel}</span>
            <h2 class="title">${safe.title || 'Opportunity'}</h2>
            <div class="row"><span class="label">Company</span><br /><span class="value">${safe.company || 'N/A'}</span></div>
            <div class="row"><span class="label">New Status</span><br /><span class="value" style="text-transform:capitalize">${status}</span></div>
            ${safe.applyLink && status !== 'rejected' ? `<p><a class="cta" href="${fixApplyLink(safe.applyLink)}" target="_blank" rel="noreferrer">View Details</a></p>` : ''}
          </div>
          <div class="footer">
            <p>&copy; 2025 IntelliVerse - Air University Islamabad</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  },
  getCareerApplicationStatusTemplate: (opportunity, status) => {
    const safe = opportunity || {};
    const typeLabel = safe.type === 'job' ? 'Job' : 'Internship';
    const messages = {
      shortlisted: 'Your profile has been shortlisted for further consideration.',
      accepted: 'Congratulations! Your application has been accepted.',
      rejected: 'Thank you for applying. We appreciate your time and interest.',
      applied: 'Your application has been received.'
    };
    const fixApplyLink = (url) => {
      try {
        if (!url) return '';
        return String(url).replace('/career/admin', '/career');
      } catch {
        return url;
      }
    };
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Application Update - IntelliVerse</title>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #1f2937; background: #f8fafc; }
          .container { max-width: 600px; margin: 0 auto; padding: 24px; }
          .header { background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; padding: 24px; text-align: center; border-radius: 12px 12px 0 0; }
          .card { background: white; padding: 24px; border-radius: 0 0 12px 12px; box-shadow: 0 6px 16px rgba(0,0,0,0.08); }
          .title { margin: 0; font-size: 22px; color: #111827; }
          .subtitle { margin: 6px 0 0 0; font-size: 14px; color: #e5e7eb; }
          .badge { display: inline-block; padding: 6px 10px; font-size: 12px; border-radius: 999px; background: #ecfeff; color: #0e7490; margin-bottom: 12px; text-transform: capitalize; }
          .row { margin: 10px 0; }
          .label { font-size: 12px; color: #6b7280; }
          .value { font-size: 14px; color: #111827; font-weight: 600; }
          .desc { margin: 14px 0; font-size: 14px; color: #374151; white-space: pre-wrap; }
          .cta { display: inline-block; background: #4F46E5; color: white; text-decoration: none; padding: 12px 18px; border-radius: 8px; font-weight: 600; }
          .footer { text-align: center; margin-top: 16px; color: #6b7280; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1 class="title">Application Status Updated</h1>
            <p class="subtitle">IntelliVerse Career Portal</p>
          </div>
          <div class="card">
            <span class="badge">${typeLabel}</span>
            <h2 class="title">${safe.title || 'Opportunity'}</h2>
            <div class="row"><span class="label">Company</span><br /><span class="value">${safe.company || 'N/A'}</span></div>
            <div class="row"><span class="label">Status</span><br /><span class="value" style="text-transform:capitalize">${status}</span></div>
            <div class="desc">${messages[status] || messages.applied}</div>
            ${safe.applyLink ? `<p><a class="cta" href="${fixApplyLink(safe.applyLink)}" target="_blank" rel="noreferrer">View Opportunity</a></p>` : ''}
          </div>
          <div class="footer">
            <p>&copy; 2025 IntelliVerse - Air University Islamabad</p>
            <p>This is an automated message, please do not reply.</p>
          </div>
        </div>
      </body>
      </html>
    `;
  },
  getItemFoundEmailTemplate,
  sendItemFoundNotification,
  getTicketNotificationTemplate,
  sendTicketNotification,
  sendEmail: async (to, subject, html) => {
    try {
      const mailOptions = {
        from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
        to,
        subject,
        html
      };
      await transporter.sendMail(mailOptions);
      return { success: true };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
