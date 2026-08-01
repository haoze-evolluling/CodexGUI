const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { shell } = require('electron');

function validateProjectDirectory(cwd, fsImpl = fs) {
  if (!cwd || typeof cwd !== 'string') return '无效的项目目录。';
  try {
    if (!fsImpl.statSync(cwd).isDirectory()) return '项目目录不存在或不是目录。';
  } catch {
    return '项目目录不存在或无法访问。';
  }
  return undefined;
}

function toVsCodeUrl(filePath) {
  const resolved = path.resolve(filePath).replace(/\\/g, '/');
  if (/^[A-Za-z]:\//.test(resolved)) return `vscode://file/${resolved}`;
  return `vscode://file${resolved}`;
}

function runCodeCommand(filePath, spawnImpl = spawn) {
  return new Promise(resolve => {
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer = setTimeout(() => finish(true), 1500);
    let child;
    try {
      child = spawnImpl('code', ['--goto', filePath], {
        shell: true,
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {
      finish(false);
      return;
    }
    child.on('error', () => finish(false));
    child.on('exit', code => finish(code === 0 || code === null));
  });
}

async function openPathWithDefaultApp(filePath, openPathImpl = shell.openPath.bind(shell)) {
  if (!filePath || typeof filePath !== 'string') return { ok: false, error: '无效的文件路径。' };
  try {
    const error = await openPathImpl(filePath);
    if (error) return { ok: false, error };
    return { ok: true };
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

async function openProjectDirectory(cwd, options = {}) {
  const error = validateProjectDirectory(cwd, options.fs || fs);
  if (error) return { ok: false, error };
  return openPathWithDefaultApp(cwd, options.openPath || shell.openPath.bind(shell));
}

function openTerminalInDirectory(cwd, options = {}) {
  const error = validateProjectDirectory(cwd, options.fs || fs);
  if (error) return Promise.resolve({ ok: false, error });
  const spawnImpl = options.spawn || spawn;
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    let child;
    try {
      child = spawnImpl('wt.exe', ['-w', 'new', '-d', cwd], {
        detached: true,
        shell: false,
        stdio: 'ignore',
      });
    } catch (cause) {
      finish({ ok: false, error: cause instanceof Error ? cause.message : String(cause) });
      return;
    }
    child.once('error', cause => finish({ ok: false, error: cause instanceof Error ? cause.message : String(cause) }));
    child.once('spawn', () => {
      child.unref();
      finish({ ok: true });
    });
  });
}

async function openPathInVsCode(filePath, options = {}) {
  if (!filePath || typeof filePath !== 'string') return { ok: false, error: '无效的文件路径。' };
  const spawnImpl = options.spawn || spawn;
  const openExternal = options.openExternal || shell.openExternal.bind(shell);
  if (await runCodeCommand(filePath, spawnImpl)) return { ok: true };
  try {
    await openExternal(toVsCodeUrl(filePath));
    return { ok: true };
  } catch (cause) {
    return {
      ok: false,
      error: cause instanceof Error ? cause.message : '无法在 VS Code 中打开该文件。',
    };
  }
}

function resolveSessionFilePath(cwd, filePath, pathImpl = path) {
  if (!filePath || typeof filePath !== 'string') return '';
  if (pathImpl.isAbsolute(filePath)) return pathImpl.normalize(filePath);
  if (!cwd || typeof cwd !== 'string') return pathImpl.normalize(filePath);
  return pathImpl.normalize(pathImpl.join(cwd, filePath));
}

module.exports = {
  openProjectDirectory,
  openTerminalInDirectory,
  openPathInVsCode,
  openPathWithDefaultApp,
  resolveSessionFilePath,
  toVsCodeUrl,
};
