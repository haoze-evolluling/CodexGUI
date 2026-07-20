const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { buildCodexArgs, buildSpawnOptions, createDiagnostics, createEventParser, eventToMessage, eventToActivity } = require('./codex-runner.cjs');
const { RequestManager } = require('./request-manager.cjs');
const { loadCodexHistory, mergeSessions } = require('./codex-history.cjs');
const { buildArchiveArgs, removeArchivedSessions } = require('./codex-archive.cjs');

let win;
const requests = new RequestManager();
const dataFile = () => path.join(app.getPath('userData'), 'sessions.json');

function load() { try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); } catch { return []; } }
function save(value) { fs.mkdirSync(path.dirname(dataFile()), { recursive: true }); fs.writeFileSync(dataFile(), JSON.stringify(value, null, 2)); }

function create() {
  win = new BrowserWindow({ width: 1280, height: 800, minWidth: 900, minHeight: 600, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  if (!app.isPackaged) win.loadURL('http://127.0.0.1:5173');
  else win.loadFile(path.join(__dirname, '../dist/index.html'));
}

function runGit(args, cwd) {
  return new Promise(resolve => {
    let child;
    try { child = spawn('git', args, { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch { resolve(''); return; }
    let output = '';
    child.stdout.on('data', data => { output += data.toString(); });
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(output));
  });
}

function resolveChangePath(cwd, filePath) {
  const absolute = path.resolve(cwd, filePath);
  const relative = path.relative(cwd, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return { absolute, relative };
}

async function attachDiffs(cwd, files) {
  return Promise.all(files.map(async file => {
    const resolved = resolveChangePath(cwd, file.path);
    if (!resolved) return file;
    let diff = await runGit(['diff', '--no-ext-diff', '--unified=3', '--', resolved.relative], cwd);
    if (!diff && file.kind === 'add') {
      const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
      diff = await runGit(['diff', '--no-index', '--unified=3', '--', nullDevice, resolved.absolute], cwd);
    }
    return diff ? { ...file, diff } : file;
  }));
}

function emitActivity(sessionId, cwd, activity) {
  win.webContents.send('cli:activity', { sessionId, activity });
  if (activity.type === 'file_change' && activity.status === 'completed') {
    attachDiffs(cwd, activity.files).then(files => {
      win.webContents.send('cli:activity', { sessionId, activity: { ...activity, files } });
    });
  }
}

app.whenReady().then(() => {
  create();
  const history = () => mergeSessions(load(), loadCodexHistory(path.join(app.getPath('home'), '.codex')));
  ipcMain.handle('sessions:list', history);
  ipcMain.handle('sessions:history', history);
  ipcMain.handle('sessions:save', (_, session) => { const all = load().filter(item => item.id !== session.id); all.unshift(session); save(all); return all; });
  ipcMain.handle('sessions:archive', (_, session) => {
    if (!session?.id) return { ok: false, error: '无效的会话。' };
    const removeLocalCopy = () => { const remaining = removeArchivedSessions(load(), session); save(remaining); return remaining; };
    if (!session.threadId) { removeLocalCopy(); return { ok: true }; }
    return new Promise(resolve => {
      const diagnostics = createDiagnostics();
      let settled = false;
      const finish = result => { if (!settled) { settled = true; resolve(result); } };
      let child;
      try { child = spawn('codex', buildArchiveArgs(session.threadId), buildSpawnOptions(session.cwd || process.cwd())); }
      catch (error) { finish({ ok: false, error: error.message }); return; }
      child.stderr.on('data', data => diagnostics.add(data.toString()));
      child.on('error', error => finish({ ok: false, error: error.message }));
      child.on('close', code => {
        const error = diagnostics.errorForExit(code);
        if (error) finish({ ok: false, error });
        else { removeLocalCopy(); finish({ ok: true }); }
      });
    });
  });
  ipcMain.handle('dialog:folder', async () => {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('cli:start', (_, options) => {
    if (!options.sessionId || requests.isRunning(options.sessionId)) return false;
    const cwd = options.cwd || process.cwd();
    const diagnostics = createDiagnostics();
    const parser = createEventParser(event => {
      const message = eventToMessage(event);
      const activity = eventToActivity(event);
      if (message.threadId) win.webContents.send('cli:thread', { sessionId: options.sessionId, threadId: message.threadId });
      if (message.text) win.webContents.send('cli:data', { sessionId: options.sessionId, stream: 'stdout', text: message.text });
      if (activity.activity) emitActivity(options.sessionId, cwd, activity.activity);
    }, line => diagnostics.add(line));
    const child = spawn(options.command || 'codex', buildCodexArgs(options.prompt, options.threadId), buildSpawnOptions(cwd));
    requests.start(options.sessionId, child);
    child.stdout.on('data', data => parser.push(data.toString()));
    child.stderr.on('data', data => diagnostics.add(data.toString()));
    child.on('close', code => {
      parser.end();
      const error = diagnostics.errorForExit(code);
      if (error) win.webContents.send('cli:error', { sessionId: options.sessionId, error });
      win.webContents.send('cli:exit', { sessionId: options.sessionId, code });
      requests.finish(options.sessionId, child);
    });
    child.on('error', error => { win.webContents.send('cli:error', { sessionId: options.sessionId, error: error.message }); requests.finish(options.sessionId, child); });
    return true;
  });
  ipcMain.handle('cli:stop', (_, sessionId) => requests.stop(sessionId));
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
