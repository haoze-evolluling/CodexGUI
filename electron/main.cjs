const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { createCodexAppServer } = require('./codex-app-server.cjs');
const { buildCodexSpawnConfig, resolveCodexInstallation } = require('./codex-installation.cjs');
const { createDiffAttacher } = require('./git-diff.cjs');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');
const { createSessionStore } = require('./session-store.cjs');

let win;
const sessionTitles = new Map();
const recentErrors = new Set();

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

function notifySessionFinished(payload, failed) {
  if (!win || win.isDestroyed() || win.isFocused()) return;
  if (!Notification.isSupported()) return;
  const sessionId = payload?.sessionId;
  if (!sessionId) return;
  const title = sessionTitles.get(sessionId) || 'Codex 会话';
  const notification = new Notification({
    title,
    body: failed ? '会话执行失败' : '会话已完成',
  });
  notification.on('click', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('sessions:focus', { sessionId });
  });
  notification.show();
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const userData = app.getPath('userData');
  const store = createSessionStore(
    path.join(userData, 'sessions.json'),
    path.join(userData, 'archived-threads.json'),
    path.join(userData, 'settings.json'),
    path.join(userData, 'archived-sessions.json'),
  );
  createWindow(store.loadSettings().theme);
  const getInstallation = () => resolveCodexInstallation({ customPath: store.loadSettings().codexPath });
  const codexProcess = createCodexAppServer({
    attachDiffs: createDiffAttacher(spawn),
    getSpawnConfig: () => buildCodexSpawnConfig(getInstallation()),
    send: (channel, value) => {
      if (channel === 'cli:error' && value?.sessionId) recentErrors.add(value.sessionId);
      if (channel === 'cli:exit' && value?.sessionId) {
        const failed = recentErrors.has(value.sessionId) || value.status === 'failed' || value.status === 'error';
        recentErrors.delete(value.sessionId);
        notifySessionFinished(value, failed);
      }
      win?.webContents.send(channel, value);
    },
    spawn,
  });

  ipcMain.handle('sessions:remember-title', (_, sessionId, title) => {
    if (typeof sessionId === 'string' && sessionId) {
      sessionTitles.set(sessionId, typeof title === 'string' && title.trim() ? title.trim() : 'Codex 会话');
    }
    return true;
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
