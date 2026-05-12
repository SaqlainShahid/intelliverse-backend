const fs = require("fs");
const path = require("path");
const LostAndFoundItem = require("../models/LostAndFoundItem");
const User = require("../models/User");
const Notification = require("../models/Notification");
const { sendItemFoundNotification } = require('../utils/emailService');

// @desc    Get all lost/found items with optional search, filters, pagination & sorting
// @route   GET /api/lost?search=phone&status=lost&page=1&limit=10&sort=oldest
const getAllItems = async (req, res) => {
  try {
    const { search, status, reportedBy, claimedBy, approvalStatus, page = 1, limit = 10, sort = "newest" } = req.query;
    const currentUser = req.user; // Authenticated user from middleware
    const isAdmin = currentUser?.role === 'admin';

    const and = [];
    const base = {};
    if (status) base.status = status; // "lost", "found", "claimed"
    if (reportedBy) base.reportedBy = reportedBy;
    if (claimedBy) base.claimedBy = claimedBy;
    if (Object.keys(base).length) and.push(base);

    if (search) {
      and.push({
        $or: [
        { itemName: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        ],
      });
    }

    if (isAdmin) {
      if (approvalStatus && ['pending', 'approved', 'rejected'].includes(String(approvalStatus))) {
        and.push({ approvalStatus: String(approvalStatus) });
      }
    } else {
      and.push({ $or: [{ approvalStatus: 'approved' }, { approvalStatus: { $exists: false } }] });
    }

    const filter = and.length === 0 ? {} : (and.length === 1 ? and[0] : { $and: and });

    // Pagination
    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 10;

    // Sorting
    let sortOption = { createdAt: -1 }; // newest first
    if (sort === "oldest") {
      sortOption = { createdAt: 1 };
    }

    const totalItems = await LostAndFoundItem.countDocuments(filter);
    const items = await LostAndFoundItem.find(filter)
      .populate('reportedBy', 'profile.firstName profile.lastName email role')
      .populate('claimedBy', 'profile.firstName profile.lastName email')
      .sort(sortOption)
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum);

    res.json({
      success: true,
      page: pageNum,
      limit: limitNum,
      totalItems,
      totalPages: Math.ceil(totalItems / limitNum),
      sort,
      items,
      currentUser: {
        id: currentUser._id,
        role: currentUser.role,
        name: `${currentUser.profile.firstName} ${currentUser.profile.lastName}`
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error", details: err.message });
  }
};

// @desc    Create a new lost/found item (without image)
// @route   POST /api/lost
const reportItem = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ success: false, message: "Request body cannot be empty" });
    }

    const currentUser = req.user; // Authenticated user from middleware

    const isLost = String(req.body.status || 'lost') === 'lost';
    const approval = (currentUser?.role === 'admin' || !isLost) ? 'approved' : 'pending';
    const newItemData = {
      ...req.body,
      reportedBy: currentUser._id, // Link to authenticated user
      approvalStatus: approval,
      approvedBy: approval === 'approved' ? currentUser._id : null,
      approvedAt: approval === 'approved' ? new Date() : null,
      rejectedBy: null,
      rejectedAt: null,
    };

    const newItem = new LostAndFoundItem(newItemData);
    const savedItem = await newItem.save();

    // Populate the reporter information
    await savedItem.populate('reportedBy', 'profile.firstName profile.lastName email role');

    res.status(201).json({ 
      success: true, 
      message: "Item reported successfully",
      item: savedItem 
    });
    try {
      const admins = await User.find({ role: 'admin', isActive: true }).select('_id preferences.notificationsEnabled').lean();
      const docs = [];
      const title = `Lost & Found: ${savedItem.itemName}`;
      const msg = savedItem.description || null;
      for (const a of admins) {
        if (a.preferences?.notificationsEnabled !== false) {
          docs.push({ user: a._id, type: 'lost_item_reported', title, message: msg, data: { itemId: savedItem._id, status: savedItem.status } });
        }
      }
      const prefReporter = await User.findById(savedItem.reportedBy._id).select('preferences.notificationsEnabled').lean();
      if (prefReporter?.preferences?.notificationsEnabled !== false) {
        docs.push({ user: savedItem.reportedBy._id, type: 'lost_item_reported', title: 'Item reported', message: savedItem.itemName, data: { itemId: savedItem._id, status: savedItem.status } });
      }
      if (docs.length) {
        const created = await Notification.insertMany(docs);
        if (global.io) {
          for (const n of created) {
            global.io.to(n.user.toString()).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
          }
        }
      }
    } catch {}
  } catch (err) {
    res.status(400).json({ success: false, error: "Invalid data", details: err.message });
  }
};

// @desc    Claim a lost/found item (only the original reporter can claim)
// @route   PUT /api/lost/:id/claim
const claimItem = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user; // Authenticated user from middleware

    // Find the item first
    const item = await LostAndFoundItem.findById(id);
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    if (item.approvalStatus && item.approvalStatus !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'This item is not approved yet'
      });
    }

    // Check if item is already claimed
    if (item.status === 'claimed') {
      return res.status(400).json({
        success: false,
        message: 'Item has already been claimed'
      });
    }

    // Only allow claiming if item is "found" and current user is the original reporter
    if (item.status !== 'found') {
      return res.status(400).json({
        success: false,
        message: 'Only found items can be claimed'
      });
    }

    // Check if current user is the one who originally reported the item
    if (item.reportedBy.toString() !== currentUser._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Only the person who originally reported this item can claim it'
      });
    }

    // Update item status to claimed
    item.status = 'claimed';
    item.claimedBy = currentUser._id;
    item.claimedAt = new Date();
    
    await item.save();

    // Populate the item for response
    await item.populate('reportedBy', 'profile.firstName profile.lastName email role');
    await item.populate('foundBy', 'profile.firstName profile.lastName email role');
    await item.populate('claimedBy', 'profile.firstName profile.lastName email role');

    console.log(`✅ ITEM CLAIMED: Item "${item.itemName}" claimed by ${currentUser.profile.firstName} ${currentUser.profile.lastName} (${currentUser.email})`);
    await item.save();

    res.json({
      success: true,
      message: 'Item claimed successfully!',
      item: item
    });
    try {
      const admins = await User.find({ role: 'admin', isActive: true }).select('_id preferences.notificationsEnabled').lean();
      const docs = [];
      const title = `Item claimed: ${item.itemName}`;
      for (const a of admins) {
        if (a.preferences?.notificationsEnabled !== false) {
          docs.push({ user: a._id, type: 'lost_item_claimed', title, message: null, data: { itemId: item._id } });
        }
      }
      const prefReporter = await User.findById(item.reportedBy).select('preferences.notificationsEnabled').lean();
      if (prefReporter?.preferences?.notificationsEnabled !== false) {
        docs.push({ user: item.reportedBy, type: 'lost_item_claimed', title: 'Item claimed', message: item.itemName, data: { itemId: item._id } });
      }
      if (docs.length) {
        const created = await Notification.insertMany(docs);
        if (global.io) {
          for (const n of created) {
            global.io.to(n.user.toString()).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
          }
        }
      }
    } catch {}

  } catch (error) {
    console.error('Claim item error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to claim item'
    });
  }
};

// @desc    Delete a lost/found item (Admins only)
// @route   DELETE /api/lost/:id
const deleteItem = async (req, res) => {
  try {
    const { id } = req.params;
    const currentUser = req.user; // Authenticated user from middleware

    const item = await LostAndFoundItem.findById(id);

    if (!item) {
      return res.status(404).json({ success: false, message: "Item not found" });
    }

    // If item has an image URL from Cloudinary, delete it
    if (item.imageUrl) {
      try {
        // Extract public_id from Cloudinary URL
        // URL format: https://res.cloudinary.com/cloud_name/image/upload/v123456/intelliverse/lost-and-found/filename.ext
        const urlParts = item.imageUrl.split('/');
        const filename = urlParts[urlParts.length - 1];
        const folder = 'intelliverse/lost-and-found';
        const publicId = `${folder}/${filename.split('.')[0]}`;
        
        const { cloudinary } = require('../utils/cloudinary');
        await cloudinary.uploader.destroy(publicId);
        console.log(`✅ Cloudinary image deleted: ${publicId}`);
      } catch (err) {
        console.error(`Failed to delete Cloudinary image:`, err);
      }
    }

    await item.deleteOne();

    console.log(`Admin ${currentUser.email} deleted item: ${item.itemName}`);

    res.status(200).json({ 
      success: true, 
      message: "Item and image deleted successfully" 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: "Server error", details: err.message });
  }
};

// @desc    Create a new lost/found item WITH image
// @route   POST /api/lost/with-image
const reportItemWithImage = async (req, res) => {
  try {
    if (!req.body || Object.keys(req.body).length === 0) {
      return res.status(400).json({ success: false, message: "Form data cannot be empty" });
    }

    const currentUser = req.user; // Authenticated user from middleware

    const isLost = String(req.body.status || 'lost') === 'lost';
    const approval = (currentUser?.role === 'admin' || !isLost) ? 'approved' : 'pending';
    const newItemData = {
      ...req.body,
      reportedBy: currentUser._id, // Link to authenticated user
      imageUrl: req.file ? req.file.path : null, // Cloudinary URL
      approvalStatus: approval,
      approvedBy: approval === 'approved' ? currentUser._id : null,
      approvedAt: approval === 'approved' ? new Date() : null,
      rejectedBy: null,
      rejectedAt: null,
    };

    const newItem = new LostAndFoundItem(newItemData);
    const savedItem = await newItem.save();

    // Populate the reporter information
    await savedItem.populate('reportedBy', 'profile.firstName profile.lastName email role');

    res.status(201).json({ 
      success: true, 
      message: "Item reported successfully with image",
      item: savedItem 
    });
    try {
      const admins = await User.find({ role: 'admin', isActive: true }).select('_id preferences.notificationsEnabled').lean();
      const docs = [];
      const title = `Lost & Found: ${savedItem.itemName}`;
      const msg = savedItem.description || null;
      for (const a of admins) {
        if (a.preferences?.notificationsEnabled !== false) {
          docs.push({ user: a._id, type: 'lost_item_reported', title, message: msg, data: { itemId: savedItem._id, status: savedItem.status } });
        }
      }
      const prefReporter = await User.findById(savedItem.reportedBy._id).select('preferences.notificationsEnabled').lean();
      if (prefReporter?.preferences?.notificationsEnabled !== false) {
        docs.push({ user: savedItem.reportedBy._id, type: 'lost_item_reported', title: 'Item reported', message: savedItem.itemName, data: { itemId: savedItem._id, status: savedItem.status } });
      }
      if (docs.length) {
        const created = await Notification.insertMany(docs);
        if (global.io) {
          for (const n of created) {
            global.io.to(n.user.toString()).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
          }
        }
      }
    } catch {}
  } catch (err) {
    res.status(400).json({ success: false, error: "Invalid data", details: err.message });
  }
};

// @desc    Update item status (any authenticated user can mark as found)
// @route   PUT /api/lost/:id/status
const updateItemStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const currentUser = req.user; // Authenticated user from middleware

    // Validate status
    if (!['lost', 'found'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Status must be either "lost" or "found"'
      });
    }

    // Find the item
    const item = await LostAndFoundItem.findById(id)
      .populate('reportedBy', 'profile.firstName profile.lastName email profile.phone');
    
    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found'
      });
    }

    if (item.approvalStatus && item.approvalStatus !== 'approved') {
      return res.status(400).json({
        success: false,
        message: 'This item is not approved yet'
      });
    }

    // Check if item is already claimed
    if (item.status === 'claimed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot change status of claimed items'
      });
    }

    // Update the status
    const oldStatus = item.status;
    item.status = status;
    
    // If marking as found, record who found it
    if (status === 'found' && oldStatus === 'lost') {
      item.foundBy = currentUser._id;
      
      // Send email notification to the original reporter
      try {
        const ownerName = `${item.reportedBy.profile.firstName} ${item.reportedBy.profile.lastName}`;
        const finderName = `${currentUser.profile.firstName} ${currentUser.profile.lastName}`;
        
        const emailResult = await sendItemFoundNotification(
          item.reportedBy.email,
          {
            ownerName: ownerName,
            itemName: item.itemName,
            description: item.description,
            location: item.location
          },
          {
            name: finderName,
            email: currentUser.email,
            phone: currentUser.profile.phone || 'Not provided'
          }
        );
        
        if (emailResult.success) {
          console.log(`📧 Email notification sent to ${item.reportedBy.email}`);
        } else {
          console.log(`⚠️ Email notification failed: ${emailResult.error}`);
        }
      } catch (emailError) {
        console.error('Email sending error:', emailError);
        // Don't fail the request if email fails
      }
    }
    
    await item.save();

    // Populate the item for response
    await item.populate('reportedBy', 'profile.firstName profile.lastName email role');
    await item.populate('foundBy', 'profile.firstName profile.lastName email role');

    // Log the status change for admin notification
    console.log(`📢 STATUS CHANGE: Item "${item.itemName}" changed from "${oldStatus}" to "${status}" by ${currentUser.profile.firstName} ${currentUser.profile.lastName} (${currentUser.email})`);

    res.json({
      success: true,
      message: `Item status updated to "${status}". ${status === 'found' ? 'Email notification sent to the owner.' : ''}`,
      item: item,
      emailSent: status === 'found',
      statusChange: {
        oldStatus,
        newStatus: status,
        changedBy: {
          name: `${currentUser.profile.firstName} ${currentUser.profile.lastName}`,
          email: currentUser.email
        },
        changedAt: new Date()
      }
    });
    try {
      const docs = [];
      if (status === 'found') {
        const prefReporter = await User.findById(item.reportedBy).select('preferences.notificationsEnabled').lean();
        if (prefReporter?.preferences?.notificationsEnabled !== false) {
          docs.push({ user: item.reportedBy, type: 'lost_item_found', title: 'Item marked as found', message: item.itemName, data: { itemId: item._id } });
        }
      }
      if (docs.length) {
        const created = await Notification.insertMany(docs);
        if (global.io) {
          for (const n of created) {
            global.io.to(n.user.toString()).emit('notification:new', { _id: n._id, type: n.type, title: n.title, message: n.message, data: n.data, createdAt: n.createdAt });
          }
        }
      }
    } catch {}

  } catch (error) {
    console.error('Update item status error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update item status'
    });
  }
};

// @desc    Approve or reject a lost/found item (Admins only)
// @route   PATCH /api/lost/:id/approval
const setItemApproval = async (req, res) => {
  try {
    const { id } = req.params;
    const { approvalStatus } = req.body;
    const currentUser = req.user;

    const next = String(approvalStatus || '');
    if (!['approved', 'rejected'].includes(next)) {
      return res.status(400).json({ success: false, message: 'approvalStatus must be "approved" or "rejected"' });
    }

    const item = await LostAndFoundItem.findById(id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });
    if (item.status !== 'lost') return res.status(400).json({ success: false, message: 'Only lost items require approval' });

    item.approvalStatus = next;
    if (next === 'approved') {
      item.approvedBy = currentUser._id;
      item.approvedAt = new Date();
      item.rejectedBy = null;
      item.rejectedAt = null;
    } else {
      item.rejectedBy = currentUser._id;
      item.rejectedAt = new Date();
      item.approvedBy = null;
      item.approvedAt = null;
    }

    await item.save();
    await item.populate('reportedBy', 'profile.firstName profile.lastName email role');
    await item.populate('claimedBy', 'profile.firstName profile.lastName email');

    return res.json({ success: true, item });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to update approval status' });
  }
};

module.exports = {
  getAllItems,
  reportItem,
  reportItemWithImage,
  claimItem,
  deleteItem,
  updateItemStatus,
  setItemApproval
};
