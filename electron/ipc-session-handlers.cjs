const { removeThreads } = require('./ipc-thread-removal.cjs');

function registerSessionHandlers({ codexProcess, ipcMain, store }) {
  ipcMain.handle('sessions:archived-list', async () => codexProcess.listThreads(true));

  ipcMain.handle('sessions:restore', async (_, target) => {
    if (!target?.threadId) return { ok: false, error: '无效的归档对话。' };
    try {
      return await codexProcess.restore(target.threadId)
        ? { ok: true }
        : { ok: false, error: '无法恢复该对话。' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('sessions:archived-remove', async (_, target) => {
    if (!target?.threadId) return { ok: false, error: '无效的归档对话。' };
    try {
      if (!await codexProcess.remove(target.threadId)) return { ok: false, error: '无法删除该对话。' };
      store.removeTokenUsage(target.threadId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('sessions:archived-clear', async () => {
    try {
      const archived = await codexProcess.listThreads(true);
      const { allSucceeded, succeededThreadIds } = await removeThreads(codexProcess, archived.map(session => session.threadId));
      store.removeTokenUsage(succeededThreadIds);
      return allSucceeded
        ? { ok: true, succeededThreadIds }
        : { ok: false, error: '部分归档对话未能删除。', succeededThreadIds };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

module.exports = { registerSessionHandlers };
