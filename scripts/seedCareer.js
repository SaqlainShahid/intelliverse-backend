require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/database');
const Internship = require('../models/Internship');
const CareerTip = require('../models/CareerTip');

async function run() {
  await connectDB();
  try {
    const samples = [
      {
        title: 'Frontend Intern (React)',
        company: 'TechNova',
        location: 'Islamabad',
        type: 'internship',
        skillsRequired: ['React', 'JavaScript', 'HTML', 'CSS', 'Git'],
        stipend: 'Rs. 35,000/month',
        eligibility: 'CS/SE/IT students, semester 4+',
        deadline: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        applyLink: 'https://example.com/apply/frontend-react',
        description: 'Work with mentors to build UI features using React and Tailwind CSS.'
      },
      {
        title: 'Backend Intern (Node.js)',
        company: 'CloudBridge',
        location: 'Remote',
        type: 'internship',
        skillsRequired: ['Node.js', 'Express', 'MongoDB', 'REST APIs', 'JWT'],
        stipend: 'Rs. 40,000/month',
        eligibility: 'CS/SE/IT students, semester 5+',
        deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        applyLink: 'https://example.com/apply/backend-node',
        description: 'Build secure APIs, write unit tests, and contribute to backend services.'
      },
      {
        title: 'Junior Software Engineer',
        company: 'InnoSoft',
        location: 'Lahore',
        type: 'job',
        skillsRequired: ['JavaScript', 'React', 'Node.js', 'SQL'],
        stipend: 'Rs. 120,000/month',
        eligibility: 'Fresh graduates',
        deadline: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000),
        applyLink: 'https://example.com/apply/junior-se',
        description: 'Full-time role collaborating across the stack to ship features.'
      }
    ];
    for (const s of samples) {
      const exists = await Internship.findOne({ title: s.title, company: s.company });
      if (!exists) await Internship.create(s);
    }
    const tips = [
      { category: 'resume', title: 'Quantify Achievements', content: 'Use metrics to show impact (e.g., improved load time by 30%).', tags: ['resume','metrics'] },
      { category: 'interview', title: 'Practice Data Structures', content: 'Review arrays, maps, sets, stacks, queues, recursion.', tags: ['interview','ds'] },
      { category: 'roadmap', title: 'Modern Frontend Stack', content: 'Learn React, routing, state management, testing, CI/CD.', tags: ['roadmap','frontend'] },
    ];
    for (const t of tips) {
      const exists = await CareerTip.findOne({ title: t.title, category: t.category });
      if (!exists) await CareerTip.create(t);
    }
    console.log('✅ Career data seeded');
  } catch (e) {
    console.error('Seed failed:', e.message);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

run();

