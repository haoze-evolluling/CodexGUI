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

function normalizeFontSize(value) {
  return value === 'medium' || value === 'large' ? value : 'small';
}

function normalizeSettings(value) {
  const codexPath = typeof value?.codexPath === 'string' ? value.codexPath.trim() : '';
  const model = typeof value?.model === 'string' ? value.model.trim() : '';
  const reasoningEffort = typeof value?.reasoningEffort === 'string' ? value.reasoningEffort.trim() : '';
  return {
    permissionMode: value?.permissionMode === 'yolo' ? 'yolo' : 'default',
    fontSize: normalizeFontSize(value?.fontSize),
    ...(codexPath ? { codexPath } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

function createSessionStore(dataFile, archivedThreadsFile, settingsFile) {
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
    loadSettings() {
      return normalizeSettings(settingsFile ? readJson(settingsFile, {}) : {});
    },
    saveSettings(settings) {
      const current = settingsFile ? readJson(settingsFile, {}) : {};
      const normalized = normalizeSettings({ ...current, ...settings });
      if (settingsFile) writeJson(settingsFile, normalized);
      return normalized;
    },
  };
}

module.exports = { createSessionStore };
