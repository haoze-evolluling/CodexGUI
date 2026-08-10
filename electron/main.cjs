const { app, BrowserWindow, Menu, ipcMain, safeStorage } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { createCodexAppServer } = require('./codex-app-server.cjs');
const { buildCodexSpawnConfig, resolveCodexInstallation } = require('./codex-installation.cjs');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');
const { createSessionStore } = require('./session-store.cjs');
const { createProviderManager } = require('./provider-manager.cjs');
const { createProviderStore } = require('./provider-store.cjs');

const APP_ID = 'com.leeha.codexgui';
const APP_ICON = path.join(__dirname, 'assets', 'app-icon.ico');
let win;

function createWindow() {
  win = new BrowserWindow({
    title: 'Codex GUI',
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 540,
    icon: APP_ICON,
    backgroundColor: '#05060f',
    frame: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (!app.isPackaged) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.setAppUserModelId(APP_ID);

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  const store = createSessionStore(
    path.join(userData, 'sessions.json'),
    path.join(userData, 'archived-threads.json'),
    path.join(userData, 'settings.json'),
    path.join(userData, 'archived-sessions.json'),
    path.join(userData, 'session-titles.json'),
    path.join(userData, 'token-usage-cache.json'),
  );
  const providerStore = createProviderStore(path.join(userData, 'providers.json'), safeStorage);
  const getInstallation = () => resolveCodexInstallation({ customPath: store.loadSettings().codexPath });
  const codexProcess = createCodexAppServer({
    attachDiffs: async () => [],
    getSpawnConfig: () => buildCodexSpawnConfig(getInstallation()),
    saveTokenUsage: (threadId, tokenUsage) => store.saveTokenUsage(threadId, tokenUsage),
    send: () => undefined,
    spawn,
  });

  registerIpcHandlers({
    codexProcess,
    ipcMain,
    providerManager: createProviderManager({
      codexHome: path.join(app.getPath('home'), '.codex'),
      providerStore,
      restart: () => codexProcess.restart(),
      isBusy: () => codexProcess.isBusy(),
    }),
    store,
  });
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
