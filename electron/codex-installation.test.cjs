const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');
const { buildCodexSpawnConfig, cleanCustomPath, resolveCodexInstallation } = require('./codex-installation.cjs');

function fakeFileSystem(files) {
  const known = new Set(files.map(file => path.normalize(file).toLowerCase()));
  return {
    statSync(file) {
      if (!known.has(path.normalize(file).toLowerCase())) throw new Error('ENOENT');
      return { isFile: () => true };
    },
  };
}

test('uses a valid custom Codex path before automatic detection', () => {
  const customPath = 'C:\\Tools\\codex.exe';
  const result = resolveCodexInstallation({
    customPath: `"${customPath}"`, env: {}, platform: 'win32', fileSystem: fakeFileSystem([customPath]),
  });
  assert.deepEqual(result, { status: 'ready', path: customPath, source: 'custom' });
  assert.equal(cleanCustomPath(` "${customPath}" `), customPath);
});

test('reports an invalid custom path instead of silently falling back', () => {
  const result = resolveCodexInstallation({
    customPath: 'C:\\Missing\\codex.exe',
    env: { APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
    platform: 'win32',
    fileSystem: fakeFileSystem(['C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd']),
  });
  assert.equal(result.status, 'invalid');
});

test('prefers an official executable on PATH over the NPM wrapper', () => {
  const officialPath = 'C:\\Program Files\\Codex\\codex.exe';
  const npmPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd';
  const result = resolveCodexInstallation({
    env: { PATH: 'C:\\Program Files\\Codex', APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
    platform: 'win32', fileSystem: fakeFileSystem([officialPath, npmPath]),
  });
  assert.deepEqual(result, { status: 'ready', path: officialPath, source: 'official' });
});

test('finds the default Windows NPM wrapper when no official executable exists', () => {
  const npmPath = 'C:\\Users\\test\\AppData\\Roaming\\npm\\codex.cmd';
  const result = resolveCodexInstallation({
    env: { PATH: '', APPDATA: 'C:\\Users\\test\\AppData\\Roaming' },
    platform: 'win32', fileSystem: fakeFileSystem([npmPath]),
  });
  assert.deepEqual(result, { status: 'ready', path: npmPath, source: 'npm' });
});

test('reports a missing installation when no candidate exists', () => {
  const result = resolveCodexInstallation({ env: {}, platform: 'win32', fileSystem: fakeFileSystem([]) });
  assert.equal(result.status, 'missing');
});

test('uses a shell only for Windows command wrappers', () => {
  const native = buildCodexSpawnConfig({ status: 'ready', path: 'C:\\Tools\\codex.exe', source: 'official' });
  const npm = buildCodexSpawnConfig({ status: 'ready', path: 'C:\\Users\\test\\npm\\codex.cmd', source: 'npm' });
  assert.equal(native.options.shell, false);
  assert.equal(npm.options.shell, process.platform === 'win32');
  assert.deepEqual(npm.args, ['app-server', '--stdio']);
});
