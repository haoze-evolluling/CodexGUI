const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { createCodexAppServer } = require('./codex-app-server.cjs');
const { buildCodexSpawnConfig, resolveCodexInstallation } = require('./codex-installation.cjs');
const { createDiffAttacher } = require('./git-diff.cjs');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');
const { createSessionStore } = require('./session-store.cjs');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#11151c',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  if (!app.isPackaged) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();

  const store = createSessionStore(
    path.join(app.getPath('userData'), 'sessions.json'),
    path.join(app.getPath('userData'), 'archived-threads.json'),
    path.join(app.getPath('userData'), 'settings.json'),
  );
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
