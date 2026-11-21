const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const VOICE_DIRECTORY = path.join(__dirname, '..', '..', 'public', 'sounds', 'voice');
const MANIFEST_PATH = path.join(VOICE_DIRECTORY, 'manifest.json');

function audioKey(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function audioPath(text) {
  return path.join(VOICE_DIRECTORY, `${audioKey(text)}.mp3`);
}

function audioUrl(text) {
  if (typeof text !== 'string' || !text || !fs.existsSync(audioPath(text))) return null;
  return `/sounds/voice/${audioKey(text)}.mp3`;
}

function readManifest() {
  try {
    return JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

module.exports = { VOICE_DIRECTORY, MANIFEST_PATH, audioKey, audioPath, audioUrl, readManifest };
