const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { createCodexAppServer } = require('./codex-app-server.cjs');
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
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (!app.isPackaged) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

app.whenReady().then(() => {
  createWindow();

  const store = createSessionStore(
    path.join(app.getPath('userData'), 'sessions.json'),
    path.join(app.getPath('userData'), 'archived-threads.json'),
    path.join(app.getPath('userData'), 'settings.json'),
  );
  const codexProcess = createCodexAppServer({
    attachDiffs: createDiffAttacher(spawn),
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
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
