const fs = require('fs');
const path = require('path');

function cleanCustomPath(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function isFile(filePath, fileSystem = fs) {
  try {
    return fileSystem.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function findOnPath(env, platform, fileSystem = fs) {
  const executable = platform === 'win32' ? 'codex.exe' : 'codex';
  for (const directory of (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory.replace(/^"|"$/g, ''), executable);
    if (isFile(candidate, fileSystem)) return candidate;
  }
  return null;
}

function resolveCodexInstallation({ customPath, env = process.env, platform = process.platform, fileSystem = fs }) {
  const configured = cleanCustomPath(customPath);
  if (configured) {
    if (isFile(configured, fileSystem)) return { status: 'ready', path: configured, source: 'custom' };
    return { status: 'invalid', path: configured, error: '配置的 Codex 可执行文件不存在。' };
  }

  const officialPath = findOnPath(env, platform, fileSystem);
  if (officialPath) return { status: 'ready', path: officialPath, source: 'official' };

  if (platform === 'win32' && env.APPDATA) {
    const npmPath = path.join(env.APPDATA, 'npm', 'codex.cmd');
    if (isFile(npmPath, fileSystem)) return { status: 'ready', path: npmPath, source: 'npm' };
  }

  return { status: 'missing', error: '未找到 Codex。请安装 Codex 或在设置中选择其可执行文件。' };
}

function buildCodexSpawnConfig(installation) {
  if (installation.status !== 'ready') throw new Error(installation.error);
  const usesShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(installation.path);
  return {
    command: installation.path,
    args: ['app-server', '--stdio'],
    options: { shell: usesShell, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] },
  };
}

module.exports = { buildCodexSpawnConfig, cleanCustomPath, resolveCodexInstallation };
