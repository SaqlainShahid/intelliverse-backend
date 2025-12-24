const Department = require('../models/Department');

const DEFAULT_DEPARTMENTS = [
  { name: 'IT', keywords: ['wifi', 'login', 'portal', 'password', 'computer', 'internet', 'technical'] },
  { name: 'Finance', keywords: ['fee', 'payment', 'scholarship', 'fine', 'dues', 'bank', 'challan'] },
  { name: 'Exams', keywords: ['result', 'date sheet', 'exam', 'grade', 'gpa', 'cgpa', 'transcript', 'rechecking'] },
  { name: 'Admissions', keywords: ['admission', 'apply', 'merit', 'eligibility', 'requirements', 'deadline'] },
  { name: 'Hostel', keywords: ['room', 'mess', 'hostel', 'warden', 'laundry', 'accommodation'] },
  { name: 'Library', keywords: ['book', 'library', 'journal', 'fine', 'borrow', 'return'] },
  { name: 'Career', keywords: ['job', 'internship', 'resume', 'cv', 'interview', 'placement'] },
  { name: 'Other', keywords: ['general', 'inquiry', 'help'] }
];

const seedDepartments = async () => {
  try {
    const count = await Department.countDocuments();
    if (count > 0) return; // Already seeded

    console.log('🌱 Seeding default departments...');
    
    await Department.insertMany(DEFAULT_DEPARTMENTS);
    
    console.log('✅ Departments seeded successfully');
  } catch (error) {
    console.error('Department seeding failed:', error);
  }
};

module.exports = { seedDepartments };