const fs = require('fs');
const path = require('path');
const { normalizeArchivedSessions, threadIdsFromArchivedSessions } = require('./codex-archive.cjs');

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

function normalizeTheme(value) {
  return value === 'dark' || value === 'system' ? value : 'light';
}

function normalizeHistoryRefreshInterval(value) {
  const interval = Number(value);
  if (!Number.isFinite(interval)) return 10;
  return Math.min(3600, Math.max(5, Math.round(interval)));
}

function normalizeSettings(value) {
  const codexPath = typeof value?.codexPath === 'string' ? value.codexPath.trim() : '';
  const model = typeof value?.model === 'string' ? value.model.trim() : '';
  const reasoningEffort = typeof value?.reasoningEffort === 'string' ? value.reasoningEffort.trim() : '';
  const projectPaths = Array.isArray(value?.projectPaths)
    ? [...new Set(value.projectPaths.filter(projectPath => typeof projectPath === 'string').map(projectPath => projectPath.trim()).filter(Boolean))]
    : [];
  return {
    permissionMode: value?.permissionMode === 'yolo' ? 'yolo' : 'default',
    fontSize: normalizeFontSize(value?.fontSize),
    theme: normalizeTheme(value?.theme),
    historyRefreshIntervalSeconds: normalizeHistoryRefreshInterval(value?.historyRefreshIntervalSeconds),
    ...(codexPath ? { codexPath } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(projectPaths.length ? { projectPaths } : {}),
  };
}

function createSessionStore(dataFile, archivedThreadsFile, settingsFile, archivedSessionsFile) {
  const resolveArchivedSessionsFile = () => archivedSessionsFile || (archivedThreadsFile
    ? path.join(path.dirname(archivedThreadsFile), 'archived-sessions.json')
    : null);

  const loadLegacyThreadIds = () => {
    const values = readJson(archivedThreadsFile, []);
    return Array.isArray(values) ? values.filter(value => typeof value === 'string' && value) : [];
  };

  const persistArchivedSessions = sessions => {
    const normalized = normalizeArchivedSessions(sessions);
    const file = resolveArchivedSessionsFile();
    if (file) writeJson(file, normalized);
    if (archivedThreadsFile) writeJson(archivedThreadsFile, [...threadIdsFromArchivedSessions(normalized)]);
    return normalized;
  };

  return {
    loadSessions() {
      return readJson(dataFile, []);
    },
    saveSessions(sessions) {
      writeJson(dataFile, sessions);
    },
    loadArchivedThreads() {
      return threadIdsFromArchivedSessions(this.loadArchivedSessions());
    },
    saveArchivedThreads(threadIds) {
      const ids = new Set(Array.isArray(threadIds) ? threadIds : [...threadIds].filter(value => typeof value === 'string' && value));
      const current = this.loadArchivedSessions();
      const retained = current.filter(session => !session.threadId || ids.has(session.threadId));
      for (const threadId of ids) {
        if (retained.some(session => session.threadId === threadId)) continue;
        retained.push({
          id: `archived-${threadId}`,
          title: '已归档对话',
          cwd: '',
          threadId,
          updated: Date.now(),
          archivedAt: Date.now(),
        });
      }
      persistArchivedSessions(retained);
    },
    loadArchivedSessions() {
      const file = resolveArchivedSessionsFile();
      const fromFile = file ? normalizeArchivedSessions(readJson(file, [])) : [];
      if (fromFile.length) return fromFile;
      const legacy = loadLegacyThreadIds();
      if (!legacy.length) return [];
      return normalizeArchivedSessions(legacy.map(threadId => ({
        id: `archived-${threadId}`,
        title: '已归档对话',
        cwd: '',
        threadId,
        updated: Date.now(),
        archivedAt: Date.now(),
      })));
    },
    saveArchivedSessions(sessions) {
      return persistArchivedSessions(sessions);
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
