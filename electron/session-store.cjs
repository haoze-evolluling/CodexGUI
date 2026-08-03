const fs = require('fs');
const path = require('path');
const { normalizeWindowStates } = require('./window-state.cjs');

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

function normalizePlanDecisionChoices(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([key, choice]) => typeof key === 'string' && key && ['implement', 'fresh', 'stay'].includes(choice)));
}

function normalizePinnedFeatureIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(featureId => featureId === 'archive' || featureId === 'trello'))];
}

function normalizeSettings(value) {
  const codexPath = typeof value?.codexPath === 'string' ? value.codexPath.trim() : '';
  const model = typeof value?.model === 'string' ? value.model.trim() : '';
  const reasoningEffort = typeof value?.reasoningEffort === 'string' ? value.reasoningEffort.trim() : '';
  const projectPaths = Array.isArray(value?.projectPaths)
    ? [...new Set(value.projectPaths.filter(projectPath => typeof projectPath === 'string').map(projectPath => projectPath.trim()).filter(Boolean))]
    : [];
  const planDecisionChoices = normalizePlanDecisionChoices(value?.planDecisionChoices);
  const pinnedFeatureIds = normalizePinnedFeatureIds(value?.pinnedFeatureIds);
  const windowStates = normalizeWindowStates(value?.windowStates);
  return {
    permissionMode: value?.permissionMode === 'yolo' ? 'yolo' : 'default',
    fontSize: normalizeFontSize(value?.fontSize),
    theme: normalizeTheme(value?.theme),
    ...(codexPath ? { codexPath } : {}),
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
    ...(projectPaths.length ? { projectPaths } : {}),
    ...(Object.keys(planDecisionChoices).length ? { planDecisionChoices } : {}),
    ...(pinnedFeatureIds.length ? { pinnedFeatureIds } : {}),
    ...(Object.keys(windowStates).length ? { windowStates } : {}),
  };
}

function normalizeSessionTitles(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([threadId, title]) => typeof threadId === 'string' && threadId && typeof title === 'string' && title.trim())
    .map(([threadId, title]) => [threadId, title.trim()]));
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeTokenUsageBreakdown(value) {
  if (!value || typeof value !== 'object') return null;
  const keys = ['cachedInputTokens', 'inputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'];
  if (!keys.every(key => finiteNumber(value[key]) !== undefined)) return null;
  return Object.fromEntries(keys.map(key => [key, value[key]]));
}

function normalizeTokenUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const last = normalizeTokenUsageBreakdown(value.last);
  const total = normalizeTokenUsageBreakdown(value.total);
  const reportedAt = finiteNumber(value.reportedAt);
  if (!last || !total || reportedAt === undefined) return null;
  const modelContextWindow = value.modelContextWindow;
  if (modelContextWindow !== null && modelContextWindow !== undefined && finiteNumber(modelContextWindow) === undefined) return null;
  return { last, total, modelContextWindow: modelContextWindow ?? null, reportedAt };
}

function normalizeTokenUsageCache(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([threadId]) => typeof threadId === 'string' && threadId)
    .flatMap(([threadId, usage]) => {
      const normalized = normalizeTokenUsage(usage);
      return normalized ? [[threadId, normalized]] : [];
    }));
}

function createSessionStore(_dataFile, _archivedThreadsFile, settingsFile, _archivedSessionsFile, sessionTitlesFile, tokenUsageCacheFile) {
  return {
    loadSettings() {
      return normalizeSettings(settingsFile ? readJson(settingsFile, {}) : {});
    },
    saveSettings(settings) {
      const current = settingsFile ? readJson(settingsFile, {}) : {};
      const next = { ...current, ...settings };
      if (settings?.windowStates && typeof settings.windowStates === 'object' && !Array.isArray(settings.windowStates)) {
        next.windowStates = { ...current.windowStates, ...settings.windowStates };
      }
      const normalized = normalizeSettings(next);
      if (settingsFile) writeJson(settingsFile, normalized);
      return normalized;
    },
    loadSessionTitles() {
      return normalizeSessionTitles(sessionTitlesFile ? readJson(sessionTitlesFile, {}) : {});
    },
    saveSessionTitle(threadId, title) {
      const titles = this.loadSessionTitles();
      if (typeof threadId !== 'string' || !threadId || typeof title !== 'string' || !title.trim()) return titles;
      const next = { ...titles, [threadId]: title.trim() };
      if (sessionTitlesFile) writeJson(sessionTitlesFile, next);
      return next;
    },
    loadTokenUsageCache() {
      return normalizeTokenUsageCache(tokenUsageCacheFile ? readJson(tokenUsageCacheFile, {}) : {});
    },
    saveTokenUsage(threadId, tokenUsage) {
      const cache = this.loadTokenUsageCache();
      const normalized = typeof threadId === 'string' && threadId ? normalizeTokenUsage(tokenUsage) : null;
      if (!normalized) return cache;
      const next = { ...cache, [threadId]: normalized };
      if (tokenUsageCacheFile) writeJson(tokenUsageCacheFile, next);
      return next;
    },
    removeTokenUsage(threadIds) {
      const cache = this.loadTokenUsageCache();
      const ids = Array.isArray(threadIds) ? threadIds : [threadIds];
      const validIds = new Set(ids.filter(threadId => typeof threadId === 'string' && threadId));
      if (!validIds.size) return cache;
      const next = Object.fromEntries(Object.entries(cache).filter(([threadId]) => !validIds.has(threadId)));
      if (Object.keys(next).length !== Object.keys(cache).length && tokenUsageCacheFile) writeJson(tokenUsageCacheFile, next);
      return next;
    },
  };
}

module.exports = { createSessionStore };
