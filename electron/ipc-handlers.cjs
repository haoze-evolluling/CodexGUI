const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const {
  findArchivedSession,
  normalizeArchivedSessions,
  removeArchivedSessionEntry,
  removeArchivedSessions,
  upsertArchivedSession,
} = require('./codex-archive.cjs');
const { loadCodexHistory, mergeSessions } = require('./codex-history.cjs');
const { openPathInVsCode, openPathWithDefaultApp, resolveSessionFilePath } = require('./open-path.cjs');
const { filterProjectFiles, listProjectFiles } = require('./project-files.cjs');

function registerIpcHandlers({ codexHome, codexProcess, dialog, getInstallation, getWindow, ipcMain, store }) {
  ipcMain.handle('window:minimize', () => getWindow()?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    const window = getWindow();
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle('window:close', () => getWindow()?.close());
  const history = () => {
    const archivedThreads = store.loadArchivedThreads();
    return mergeSessions(store.loadSessions(), loadCodexHistory(codexHome))
      .filter(session => !session.threadId || !archivedThreads.has(session.threadId));
  };

  ipcMain.handle('sessions:list', history);
  ipcMain.handle('sessions:history', history);
  ipcMain.handle('settings:get', () => store.loadSettings());
  ipcMain.handle('settings:save', (_, settings) => store.saveSettings(settings));
  ipcMain.handle('codex:installation', () => getInstallation());
  ipcMain.handle('codex:path-save', (_, codexPath) => {
    const previous = store.loadSettings();
    const next = store.saveSettings({ codexPath: typeof codexPath === 'string' ? codexPath : '' });
    const installation = getInstallation();
    if (installation.status !== 'ready' && next.codexPath) {
      store.saveSettings({ codexPath: previous.codexPath || '' });
      return { ok: false, error: installation.error };
    }
    if (!codexProcess.reload()) {
      store.saveSettings({ codexPath: previous.codexPath || '' });
      return { ok: false, error: 'Codex 正在执行任务，暂时无法更改路径。' };
    }
    return { ok: true, settings: next, installation };
  });
  ipcMain.handle('sessions:save', (_, session) => {
    const all = store.loadSessions().filter(item => item.id !== session.id);
    all.unshift(session);
    store.saveSessions(all);
    return all;
  });
  ipcMain.handle('sessions:archive', (_, session) => {
    if (!session?.id) return { ok: false, error: '无效的会话。' };
    store.saveSessions(removeArchivedSessions(store.loadSessions(), session));
    store.saveArchivedSessions(upsertArchivedSession(store.loadArchivedSessions(), session));
    return { ok: true };
  });
  ipcMain.handle('sessions:archived-list', () => store.loadArchivedSessions());
  ipcMain.handle('sessions:restore', (_, target) => {
    const archived = findArchivedSession(store.loadArchivedSessions(), target);
    if (!archived) return { ok: false, error: '未找到归档会话。' };

    let restored = archived;
    if ((!Array.isArray(restored.timeline) || !restored.timeline.length) && restored.threadId) {
      const fromHistory = loadCodexHistory(codexHome).find(session => session.threadId === restored.threadId);
      if (fromHistory) {
        restored = {
          ...fromHistory,
          id: archived.id.startsWith('archived-') ? fromHistory.id : archived.id,
          title: archived.title && archived.title !== '已归档对话' ? archived.title : fromHistory.title,
          cwd: archived.cwd || fromHistory.cwd,
          model: archived.model || fromHistory.model,
          reasoningEffort: archived.reasoningEffort || fromHistory.reasoningEffort,
          collaborationMode: archived.collaborationMode || fromHistory.collaborationMode,
          updated: Math.max(archived.updated || 0, fromHistory.updated || 0, Date.now()),
        };
      }
    }

    if (!restored.cwd && !restored.threadId) {
      return { ok: false, error: '该归档会话缺少可恢复的内容。' };
    }

    const { archivedAt, ...session } = restored;
    const all = store.loadSessions().filter(item => item.id !== session.id && (!session.threadId || item.threadId !== session.threadId));
    all.unshift(session);
    store.saveSessions(all);
    store.saveArchivedSessions(removeArchivedSessionEntry(store.loadArchivedSessions(), archived));
    return { ok: true, session };
  });
  ipcMain.handle('sessions:archived-remove', (_, target) => {
    const archived = findArchivedSession(store.loadArchivedSessions(), target);
    if (!archived) return { ok: false, error: '未找到归档会话。' };
    store.saveArchivedSessions(removeArchivedSessionEntry(store.loadArchivedSessions(), archived));
    return { ok: true };
  });
  ipcMain.handle('projects:delete', (_, cwd, sessions) => {
    if (typeof cwd !== 'string' || !cwd) return { ok: false, error: '无效的项目。' };
    if (!Array.isArray(sessions) || sessions.some(session => !session?.id || session.cwd !== cwd)) {
      return { ok: false, error: '无效的项目会话。' };
    }
    let storedSessions = store.loadSessions();
    let archivedSessions = store.loadArchivedSessions();
    for (const session of sessions) {
      storedSessions = removeArchivedSessions(storedSessions, session);
      archivedSessions = upsertArchivedSession(archivedSessions, session);
    }
    store.saveSessions(storedSessions);
    store.saveArchivedSessions(archivedSessions);
    const settings = store.loadSettings();
    store.saveSettings({ projectPaths: (settings.projectPaths || []).filter(projectPath => projectPath !== cwd) });
    return { ok: true };
  });
  ipcMain.handle('dialog:folder', async () => {
    const result = await dialog.showOpenDialog(getWindow(), { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('dialog:files', async (_, defaultPath) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      defaultPath: typeof defaultPath === 'string' ? defaultPath : undefined,
      properties: ['openFile', 'multiSelections'],
    });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle('dialog:codex-executable', async (_, defaultPath) => {
    const result = await dialog.showOpenDialog(getWindow(), {
      defaultPath: typeof defaultPath === 'string' && defaultPath ? defaultPath : undefined,
      filters: process.platform === 'win32'
        ? [{ name: 'Codex 可执行文件', extensions: ['exe', 'cmd', 'bat'] }, { name: '所有文件', extensions: ['*'] }]
        : undefined,
      properties: ['openFile'],
    });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('files:list-project', (_, cwd) => {
    if (typeof cwd !== 'string' || !cwd) return [];
    return listProjectFiles(cwd, { fs, path });
  });
  ipcMain.handle('files:open', async (_, cwd, filePath) => {
    const absolute = resolveSessionFilePath(cwd, filePath);
    return openPathWithDefaultApp(absolute);
  });
  ipcMain.handle('files:open-vscode', async (_, cwd, filePath) => {
    const absolute = resolveSessionFilePath(cwd, filePath);
    return openPathInVsCode(absolute);
  });
  ipcMain.handle('files:filter', (_, files, query) => filterProjectFiles(files, query));
  ipcMain.handle('cli:start', (_, options) => codexProcess.start(options));
  ipcMain.handle('cli:stop', (_, sessionId) => codexProcess.stop(sessionId));
  ipcMain.handle('cli:compact', (_, sessionId, threadId) => codexProcess.compact(sessionId, threadId));
  ipcMain.handle('cli:rollback', (_, sessionId, threadId) => codexProcess.rollback(sessionId, threadId));
  ipcMain.handle('cli:reset-session', (_, sessionId) => codexProcess.resetSession(sessionId));
  ipcMain.handle('cli:models', () => codexProcess.listModels());
  ipcMain.handle('cli:collaboration-modes', () => codexProcess.listCollaborationModes());
  ipcMain.handle('cli:skills', (_, cwd, forceReload) => codexProcess.listSkills(cwd, forceReload));
  ipcMain.handle('cli:answer-user-input', (_, itemId, answers) => codexProcess.answerUserInput(itemId, answers));
}

module.exports = { registerIpcHandlers };
