const { spawn } = require('child_process');
const path = require('path');
const { shell } = require('electron');

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
  openPathInVsCode,
  openPathWithDefaultApp,
  resolveSessionFilePath,
  toVsCodeUrl,
};
