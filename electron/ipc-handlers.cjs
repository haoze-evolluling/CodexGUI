const { removeArchivedSessions } = require('./codex-archive.cjs');
const { loadCodexHistory, mergeSessions } = require('./codex-history.cjs');

function registerIpcHandlers({ codexHome, codexProcess, dialog, getWindow, ipcMain, store }) {
  const history = () => {
    const archivedThreads = store.loadArchivedThreads();
    return mergeSessions(store.loadSessions(), loadCodexHistory(codexHome))
      .filter(session => !session.threadId || !archivedThreads.has(session.threadId));
  };

  ipcMain.handle('sessions:list', history);
  ipcMain.handle('sessions:history', history);
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
  ipcMain.handle('cli:start', (_, options) => codexProcess.start(options));
  ipcMain.handle('cli:stop', (_, sessionId) => codexProcess.stop(sessionId));
  ipcMain.handle('cli:compact', (_, sessionId, threadId) => codexProcess.compact(sessionId, threadId));
  ipcMain.handle('cli:reset-session', (_, sessionId) => codexProcess.resetSession(sessionId));
  ipcMain.handle('cli:models', () => codexProcess.listModels());
  ipcMain.handle('cli:collaboration-modes', () => codexProcess.listCollaborationModes());
  ipcMain.handle('cli:answer-user-input', (_, itemId, answers) => codexProcess.answerUserInput(itemId, answers));
}

module.exports = { registerIpcHandlers };
