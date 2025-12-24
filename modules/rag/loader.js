const fs = require('fs');
const path = require('path');

const POLICIES_DIR = path.join(__dirname, 'policies');

function loadPolicyFiles() {
  if (!fs.existsSync(POLICIES_DIR)) {
    return [];
  }
  const files = fs.readdirSync(POLICIES_DIR).filter(f => f.endsWith('.txt'));
  return files.map(filename => {
    const filePath = path.join(POLICIES_DIR, filename);
    const content = fs.readFileSync(filePath, 'utf8');
    return { id: filename, text: content, metadata: { source: 'policy', filename } };
  });
}

module.exports = {
  loadPolicyFiles,
  POLICIES_DIR,
};

