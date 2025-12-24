const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();

const promoteToAdmin = async (email) => {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Find user by email
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      console.log(`❌ User with email ${email} not found`);
      return;
    }

    if (user.role === 'admin') {
      console.log(`✅ User ${email} is already an admin`);
      return;
    }

    // Update user role to admin
    user.role = 'admin';
    await user.save();

    console.log(`✅ Successfully promoted ${email} to admin`);
    console.log(`   Name: ${user.profile.firstName} ${user.profile.lastName}`);
    console.log(`   Department: ${user.profile.department}`);
    console.log(`   Previous Role: ${user.role}`);

  } catch (error) {
    console.error('Error promoting user to admin:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Get email from command line arguments
const email = process.argv[2];

if (!email) {
  console.log('Usage: node promoteToAdmin.js <email>');
  console.log('Example: node promoteToAdmin.js admin@university.edu');
  process.exit(1);
}

promoteToAdmin(email); 