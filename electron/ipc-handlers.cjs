const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const { shell } = require('electron');
const { openPathInVsCode, openPathWithDefaultApp, openProjectDirectory, openTerminalInDirectory, resolveSessionFilePath } = require('./open-path.cjs');
const { filterProjectFiles } = require('./project-files.cjs');
const { registerSessionHandlers } = require('./ipc-session-handlers.cjs');

function registerIpcHandlers({ codexHome, codexProcess, dialog, getInstallation, getWindow, ipcMain, loadDiff, store }) {
  ipcMain.handle('window:minimize', () => getWindow()?.minimize());
  ipcMain.handle('window:toggle-maximize', () => {
    const window = getWindow();
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle('window:close', () => getWindow()?.close());
  registerSessionHandlers({ codexHome, codexProcess, getInstallation, ipcMain, store });
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
  ipcMain.handle('files:list-project', async (_, cwd) => {
    if (typeof cwd !== 'string' || !cwd) return [];
    return new Promise(resolve => {
      const worker = new Worker(path.join(__dirname, 'project-files-worker.cjs'), { workerData: { root: cwd } });
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        worker.terminate().catch(() => undefined);
        resolve(value);
      };
      worker.once('message', value => finish(Array.isArray(value?.files) ? value.files : []));
      worker.once('error', () => finish([]));
      worker.once('exit', code => { if (code !== 0) finish([]); });
    });
  });
  ipcMain.handle('files:open', async (_, cwd, filePath) => {
    const absolute = resolveSessionFilePath(cwd, filePath);
    return openPathWithDefaultApp(absolute);
  });
  ipcMain.handle('files:open-vscode', async (_, cwd, filePath) => {
    const absolute = resolveSessionFilePath(cwd, filePath);
    return openPathInVsCode(absolute);
  });
  ipcMain.handle('files:open-project-directory', (_, cwd) => openProjectDirectory(cwd, { fs }));
  ipcMain.handle('files:open-terminal', (_, cwd) => openTerminalInDirectory(cwd, { fs }));
  ipcMain.handle('files:filter', (_, files, query) => filterProjectFiles(files, query));
  ipcMain.handle('files:diff', async (_, cwd, file) => {
    if (typeof cwd !== 'string' || !cwd || !file?.path || !loadDiff) return null;
    return (await loadDiff(cwd, file))[0] || null;
  });
  ipcMain.handle('cli:start', (_, options) => codexProcess.start(options));
  ipcMain.handle('cli:stop', (_, sessionId) => codexProcess.stop(sessionId));
  ipcMain.handle('cli:compact', (_, sessionId, threadId) => codexProcess.compact(sessionId, threadId));
  ipcMain.handle('cli:rollback', (_, sessionId, threadId) => codexProcess.rollback(sessionId, threadId));
  ipcMain.handle('cli:models', () => codexProcess.listModels());
  ipcMain.handle('cli:collaboration-modes', () => codexProcess.listCollaborationModes());
  ipcMain.handle('cli:skills', (_, cwd, forceReload) => codexProcess.listSkills(cwd, forceReload));
  ipcMain.handle('cli:answer-user-input', (_, itemId, answers) => codexProcess.answerUserInput(itemId, answers));
}

module.exports = { registerIpcHandlers };
