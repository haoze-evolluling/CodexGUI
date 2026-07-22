const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { createCodexAppServer } = require('./codex-app-server.cjs');
const { buildCodexSpawnConfig, resolveCodexInstallation } = require('./codex-installation.cjs');
const { createDiffAttacher } = require('./git-diff.cjs');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');
const { createSessionStore } = require('./session-store.cjs');

let win;

function resolveInitialTheme(theme) {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function createWindow(theme) {
  const initialTheme = resolveInitialTheme(theme);
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: initialTheme === 'dark' ? '#11151c' : '#f7f9fc',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  if (!app.isPackaged) win.loadURL(`http://127.0.0.1:5173?initialTheme=${initialTheme}`);
  else win.loadFile(path.join(__dirname, '../dist/index.html'), { query: { initialTheme } });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const store = createSessionStore(
    path.join(app.getPath('userData'), 'sessions.json'),
    path.join(app.getPath('userData'), 'archived-threads.json'),
    path.join(app.getPath('userData'), 'settings.json'),
  );
  createWindow(store.loadSettings().theme);
  const getInstallation = () => resolveCodexInstallation({ customPath: store.loadSettings().codexPath });
  const codexProcess = createCodexAppServer({
    attachDiffs: createDiffAttacher(spawn),
    getSpawnConfig: () => buildCodexSpawnConfig(getInstallation()),
    send: (channel, value) => win.webContents.send(channel, value),
    spawn,
  });

  registerIpcHandlers({
    codexHome: path.join(app.getPath('home'), '.codex'),
    codexProcess,
    dialog,
    getWindow: () => win,
    ipcMain,
    store,
    getInstallation,
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
