const fs = require('fs');
const path = require('path');

function readJson(filePath, fallback) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function normalizeFontSize(value) {
  return ['small', 'medium', 'large'].includes(value) ? value : 'medium';
}

function normalizeTheme(value) {
  return value === 'light' ? 'light' : 'dark';
}

function normalizeSettings(value) {
  const codexPath = typeof value?.codexPath === 'string' ? value.codexPath.trim() : '';
  return {
    ...(codexPath ? { codexPath } : {}),
    fontSize: normalizeFontSize(value?.fontSize),
    theme: normalizeTheme(value?.theme),
  };
}

function createSessionStore(_dataFile, _archivedThreadsFile, settingsFile, _archivedSessionsFile, _sessionTitlesFile, tokenUsageCacheFile) {
  return {
    loadSettings() { return normalizeSettings(settingsFile ? readJson(settingsFile, {}) : {}); },
    saveSettings(nextSettings) {
      const next = normalizeSettings({ ...this.loadSettings(), ...(nextSettings || {}) });
      if (settingsFile) writeJson(settingsFile, next);
      return next;
    },
    loadTokenUsageCache() { return tokenUsageCacheFile ? readJson(tokenUsageCacheFile, {}) : {}; },
    saveTokenUsage(threadId, tokenUsage) {
      if (!threadId || !tokenUsage || !tokenUsageCacheFile) return this.loadTokenUsageCache();
      const cache = this.loadTokenUsageCache();
      cache[threadId] = tokenUsage;
      writeJson(tokenUsageCacheFile, cache);
      return cache;
    },
    removeTokenUsage(threadIds) {
      const ids = new Set((Array.isArray(threadIds) ? threadIds : [threadIds]).filter(Boolean));
      const cache = this.loadTokenUsageCache();
      const next = Object.fromEntries(Object.entries(cache).filter(([threadId]) => !ids.has(threadId)));
      if (tokenUsageCacheFile && Object.keys(next).length !== Object.keys(cache).length) writeJson(tokenUsageCacheFile, next);
      return next;
    },
  };
}

module.exports = { createSessionStore };
