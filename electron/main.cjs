const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, safeStorage, screen } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { createCodexAppServer } = require('./codex-app-server.cjs');
const { buildCodexSpawnConfig, resolveCodexInstallation } = require('./codex-installation.cjs');
const { createDiffAttacher, createDiffLoader } = require('./git-diff.cjs');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');
const { createSessionStore } = require('./session-store.cjs');
const { createTrelloStore } = require('./trello-store.cjs');
const { createProviderManager } = require('./provider-manager.cjs');
const { createProviderStore } = require('./provider-store.cjs');
const { attachWindowState, restoreWindowState } = require('./window-state.cjs');

const APP_ID = 'com.leeha.codexgui';
const APP_ICON = path.join(__dirname, 'assets', 'app-icon.ico');
app.setAppUserModelId(APP_ID);

let win;
let trelloWin;
const recentErrors = new Set();

function resolveInitialTheme(theme) {
  if (theme === 'dark') return 'dark';
  if (theme === 'light') return 'light';
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function createWindow(theme, savedState, store) {
  const initialTheme = resolveInitialTheme(theme);
  const restored = restoreWindowState(savedState, {
    defaultBounds: { x: 0, y: 0, width: 1280, height: 800 },
    minWidth: 900,
    minHeight: 600,
    displays: screen.getAllDisplays(),
    primaryDisplay: screen.getPrimaryDisplay(),
  });
  win = new BrowserWindow({
    title: 'Codex GUI',
    ...restored.bounds,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: initialTheme === 'dark' ? '#11151c' : '#f7f9fc',
    icon: APP_ICON,
    frame: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  attachWindowState(win, { key: 'main', store });
  if (restored.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  if (!app.isPackaged) win.loadURL(`http://127.0.0.1:5173?initialTheme=${initialTheme}`);
  else win.loadFile(path.join(__dirname, '../dist/index.html'), { query: { initialTheme } });
}

function createTrelloWindow(theme, savedState, store) {
  if (trelloWin && !trelloWin.isDestroyed()) {
    if (trelloWin.isMinimized()) trelloWin.restore();
    trelloWin.show();
    trelloWin.focus();
    return trelloWin;
  }

  const initialTheme = resolveInitialTheme(theme);
  const restored = restoreWindowState(savedState, {
    defaultBounds: { x: 0, y: 0, width: 1440, height: 900 },
    minWidth: 1080,
    minHeight: 680,
    displays: screen.getAllDisplays(),
    primaryDisplay: screen.getPrimaryDisplay(),
  });
  trelloWin = new BrowserWindow({
    title: 'Trello 看板',
    ...restored.bounds,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: initialTheme === 'dark' ? '#05060f' : '#fafaf9',
    icon: APP_ICON,
    frame: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  attachWindowState(trelloWin, { key: 'trello', store });
  if (restored.maximized) trelloWin.maximize();
  trelloWin.once('ready-to-show', () => {
    if (!trelloWin || trelloWin.isDestroyed()) return;
    trelloWin.show();
    trelloWin.focus();
  });
  trelloWin.on('closed', () => { trelloWin = undefined; });
  if (!app.isPackaged) trelloWin.loadURL(`http://127.0.0.1:5173/?window=trello&initialTheme=${initialTheme}`);
  else trelloWin.loadFile(path.join(__dirname, '../dist/index.html'), { query: { window: 'trello', initialTheme } });
  return trelloWin;
}

function broadcastTheme(theme) {
  const payload = { theme, effectiveTheme: resolveInitialTheme(theme) };
  if (win && !win.isDestroyed()) win.webContents.send('ui:theme-changed', payload);
  if (trelloWin && !trelloWin.isDestroyed()) trelloWin.webContents.send('ui:theme-changed', payload);
}

function notifySession(payload, title, body, onlyWhenUnfocused = false) {
  if (!win || win.isDestroyed() || (onlyWhenUnfocused && win.isFocused())) return;
  if (!Notification.isSupported()) return;
  const sessionId = payload?.sessionId;
  if (!sessionId) return;
  const notification = new Notification({
    title,
    body,
    icon: APP_ICON,
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

function notifySessionFinished(payload, failed) {
  notifySession(payload, 'Codex 会话', failed ? '会话执行失败' : '会话已完成', true);
}

function notifyPlanDecision(payload) {
  notifySession(payload, 'Codex 计划需要你的决定', '计划已生成，请选择下一步');
}

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
  const trelloStore = createTrelloStore(path.join(userData, 'trello-board.json'));
  const providerStore = createProviderStore(path.join(userData, 'providers.json'), safeStorage);
  const initialSettings = store.loadSettings();
  createWindow(initialSettings.theme, initialSettings.windowStates?.main, store);
  const getInstallation = () => resolveCodexInstallation({ customPath: store.loadSettings().codexPath });
  const codexProcess = createCodexAppServer({
    attachDiffs: createDiffAttacher(spawn),
    getSpawnConfig: () => buildCodexSpawnConfig(getInstallation()),
    saveTokenUsage: (threadId, tokenUsage) => store.saveTokenUsage(threadId, tokenUsage),
    send: (channel, value) => {
      if (channel === 'cli:error' && value?.sessionId) recentErrors.add(value.sessionId);
      if (channel === 'cli:plan-ready') notifyPlanDecision(value);
      if (channel === 'cli:exit' && value?.sessionId) {
        const failed = recentErrors.has(value.sessionId) || value.status === 'failed' || value.status === 'error';
        recentErrors.delete(value.sessionId);
        if (!value.hasPlan) notifySessionFinished(value, failed);
      }
      win?.webContents.send(channel, value);
    },
    spawn,
  });

  registerIpcHandlers({
    loadDiff: createDiffLoader(spawn),
    codexHome: path.join(app.getPath('home'), '.codex'),
    codexProcess,
    dialog,
    getWindowForSender: sender => BrowserWindow.fromWebContents(sender) || win,
    getWindow: () => win,
    ipcMain,
    store,
    providerManager: createProviderManager({
      codexHome: path.join(app.getPath('home'), '.codex'),
      providerStore,
      restart: () => codexProcess.restart(),
      isBusy: () => codexProcess.isBusy(),
    }),
    getInstallation,
    openTrelloWindow: () => {
      const settings = store.loadSettings();
      return createTrelloWindow(settings.theme, settings.windowStates?.trello, store);
    },
    onThemeChanged: theme => broadcastTheme(theme),
    trelloStore,
  });

  nativeTheme.on('updated', () => {
    const theme = store.loadSettings().theme;
    if (theme === 'system') broadcastTheme(theme);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
