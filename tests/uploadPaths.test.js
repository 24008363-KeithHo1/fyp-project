const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { ensureUploadDir, getUploadDir } = require('../utils/upload');

test('ensureUploadDir creates a writable uploads directory', () => {
  const tempDir = path.join(__dirname, '..', 'tmp-upload-test');
  if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });

  const createdDir = ensureUploadDir(tempDir);
  assert.equal(createdDir, tempDir);
  assert.ok(fs.existsSync(createdDir));

  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('getUploadDir resolves to the project uploads folder', () => {
  const dir = getUploadDir();
  assert.ok(dir.endsWith(path.join('fyp-project', 'uploads')) || dir.endsWith('uploads'));
});
