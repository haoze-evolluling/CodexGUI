const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const { loadCodexHistory } = require('./codex-history.cjs');
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
    return loadCodexHistory(codexHome);
  };
  const archivedHistory = () => loadCodexHistory(codexHome, 'archived_sessions');

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
  ipcMain.handle('sessions:archive', async (_, session) => {
    if (!session?.threadId) return { ok: false, error: '该对话尚未创建 Codex 线程，无法归档。' };
    try {
      return await codexProcess.archive(session.threadId) ? { ok: true } : { ok: false, error: '无法归档该对话。' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('sessions:archived-list', archivedHistory);
  ipcMain.handle('sessions:restore', async (_, target) => {
    if (!target?.threadId) return { ok: false, error: '无效的归档对话。' };
    try {
      if (!await codexProcess.restore(target.threadId)) return { ok: false, error: '无法恢复该对话。' };
      const session = history().find(item => item.threadId === target.threadId);
      return session ? { ok: true, session } : { ok: false, error: 'Codex 尚未返回已恢复的对话。' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('sessions:archived-remove', async (_, target) => {
    if (!target?.threadId) return { ok: false, error: '无效的归档对话。' };
    try {
      return await codexProcess.remove(target.threadId) ? { ok: true } : { ok: false, error: '无法删除该对话。' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('sessions:archived-clear', async () => {
    const archived = archivedHistory();
    const results = await Promise.all(archived.map(session => codexProcess.remove(session.threadId).catch(() => false)));
    return results.every(Boolean) ? { ok: true } : { ok: false, error: '部分归档对话未能删除。' };
  });
  ipcMain.handle('projects:delete', async (_, cwd, sessions) => {
    if (typeof cwd !== 'string' || !cwd) return { ok: false, error: '无效的项目。' };
    if (!Array.isArray(sessions) || sessions.some(session => !session?.id || session.cwd !== cwd)) {
      return { ok: false, error: '无效的项目会话。' };
    }
    if (sessions.some(session => !session.threadId)) return { ok: false, error: '项目中存在尚未创建 Codex 线程的对话。' };
    try {
      const results = await Promise.all(sessions.map(session => codexProcess.remove(session.threadId)));
      if (!results.every(Boolean)) return { ok: false, error: '部分对话未能删除。' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
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
