const { removeArchivedSessions } = require('./codex-archive.cjs');
const { loadCodexHistory, mergeSessions } = require('./codex-history.cjs');

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
    if (session.threadId) {
      const archivedThreads = store.loadArchivedThreads();
      archivedThreads.add(session.threadId);
      store.saveArchivedThreads(archivedThreads);
    }
    return { ok: true };
  });
  ipcMain.handle('projects:delete', (_, cwd, sessions) => {
    if (typeof cwd !== 'string' || !cwd) return { ok: false, error: '无效的项目。' };
    if (!Array.isArray(sessions) || sessions.some(session => !session?.id || session.cwd !== cwd)) {
      return { ok: false, error: '无效的项目会话。' };
    }
    let storedSessions = store.loadSessions();
    const archivedThreads = store.loadArchivedThreads();
    for (const session of sessions) {
      storedSessions = removeArchivedSessions(storedSessions, session);
      if (session.threadId) archivedThreads.add(session.threadId);
    }
    store.saveSessions(storedSessions);
    store.saveArchivedThreads(archivedThreads);
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
