const fs = require('fs');
const path = require('path');

function getUploadDir() {
  return path.join(__dirname, '..', 'uploads');
}

function ensureUploadDir(dirPath = getUploadDir()) {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
}

module.exports = { getUploadDir, ensureUploadDir };
