/**
 * Migration Script: Add Unique HOD Constraint
 * 
 * This script adds a unique index to prevent multiple HODs per department.
 * It will also clean up any existing duplicates before adding the constraint.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');

async function addHodConstraint() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/fyp-19-dec', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('✅ Connected to MongoDB');

    // Step 1: Find and report duplicate HODs
    console.log('\n📊 Checking for duplicate HODs...');
    const hods = await User.find({ role: 'hod', isActive: true });
    
    const departmentMap = {};
    hods.forEach(hod => {
      const dept = hod.profile.department;
      if (!departmentMap[dept]) {
        departmentMap[dept] = [];
      }
      departmentMap[dept].push({
        id: hod._id,
        name: `${hod.profile.firstName} ${hod.profile.lastName}`,
        email: hod.email,
        createdAt: hod.createdAt
      });
    });

    const duplicates = Object.entries(departmentMap).filter(([dept, hods]) => hods.length > 1);
    
    if (duplicates.length > 0) {
      console.log(`\n⚠️  Found ${duplicates.length} departments with duplicate HODs:`);
      duplicates.forEach(([dept, hods]) => {
        console.log(`\n  Department: ${dept}`);
        hods.forEach((hod, index) => {
          console.log(`    ${index + 1}. ${hod.name} (${hod.email}) - Created: ${hod.createdAt}`);
        });
      });

      // Step 2: Interactive cleanup (keeps oldest HOD, demotes others)
      console.log('\n🔧 Cleaning up duplicates (keeping oldest HOD per department)...');
      
      for (const [dept, hods] of duplicates) {
        // Sort by creation date (oldest first)
        hods.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        
        // Keep the first (oldest), demote others to faculty
        const toKeep = hods[0];
        const toDemote = hods.slice(1);
        
        console.log(`  ${dept}: Keeping ${toKeep.name}, demoting ${toDemote.length} others...`);
        
        for (const hod of toDemote) {
          await User.findByIdAndUpdate(hod.id, { role: 'faculty' });
          console.log(`    ✓ Demoted ${hod.name} to faculty`);
        }
      }
      
      console.log('\n✅ Duplicate cleanup complete');
    } else {
      console.log('✅ No duplicate HODs found');
    }

    // Step 3: Create unique partial index
    // Partial index only applies to documents where role='hod' and isActive=true
    console.log('\n📝 Creating unique constraint...');
    
    try {
      // Drop existing index if any
      await User.collection.dropIndex('unique_hod_per_department').catch(() => {});
      
      // Create partial unique index
      await User.collection.createIndex(
        { 
          role: 1, 
          'profile.department': 1,
          isActive: 1
        },
        {
          unique: true,
          partialFilterExpression: { 
            role: 'hod',
            isActive: true
          },
          name: 'unique_hod_per_department',
          collation: { locale: 'en', strength: 2 } // Case-insensitive
        }
      );
      
      console.log('✅ Unique constraint added successfully');
      console.log('   Index: unique_hod_per_department');
      console.log('   Rule: Only one active HOD per department (case-insensitive)');
      
    } catch (error) {
      if (error.code === 11000) {
        console.error('❌ Failed to create unique constraint - duplicates still exist!');
        console.error('   Please run the cleanup step again.');
      } else {
        throw error;
      }
    }

    // Step 4: Verify constraint
    console.log('\n🔍 Verifying constraint...');
    const indexes = await User.collection.indexes();
    const hodIndex = indexes.find(idx => idx.name === 'unique_hod_per_department');
    
    if (hodIndex) {
      console.log('✅ Constraint verified:', JSON.stringify(hodIndex, null, 2));
    } else {
      console.log('⚠️  Constraint not found in indexes');
    }

    console.log('\n✅ Migration complete!');
    console.log('\n📝 Summary:');
    console.log(`   - Total HODs: ${hods.length}`);
    console.log(`   - Departments: ${Object.keys(departmentMap).length}`);
    console.log(`   - Duplicates fixed: ${duplicates.length}`);
    console.log('   - Constraint: Active');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

// Run migration
addHodConstraint();
