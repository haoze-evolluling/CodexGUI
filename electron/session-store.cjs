const fs = require('fs');
const path = require('path');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function createSessionStore(dataFile, archivedThreadsFile) {
  return {
    loadSessions() {
      return readJson(dataFile, []);
    },
    saveSessions(sessions) {
      writeJson(dataFile, sessions);
    },
    loadArchivedThreads() {
      const values = readJson(archivedThreadsFile, []);
      return new Set(Array.isArray(values) ? values.filter(value => typeof value === 'string') : []);
    },
    saveArchivedThreads(threadIds) {
      writeJson(archivedThreadsFile, [...threadIds]);
    },
  };
}

module.exports = { createSessionStore };
