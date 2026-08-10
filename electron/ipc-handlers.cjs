const { registerSessionHandlers } = require('./ipc-session-handlers.cjs');

function registerIpcHandlers({ codexProcess, ipcMain, providerManager, store }) {
  registerSessionHandlers({ codexProcess, ipcMain, store });

  ipcMain.handle('settings:get', () => store.loadSettings());
  ipcMain.handle('settings:save', (_, settings) => store.saveSettings(settings));
  ipcMain.handle('providers:get', () => providerManager.get());
  ipcMain.handle('providers:save', (_, provider) => {
    try { return { ok: true, state: providerManager.save(provider) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('providers:activate', async (_, id) => {
    try { return { ok: true, state: await providerManager.activate(id) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
  ipcMain.handle('providers:delete', (_, id) => {
    try { return { ok: true, state: providerManager.remove(id) }; }
    catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  });
}

module.exports = { registerIpcHandlers };
