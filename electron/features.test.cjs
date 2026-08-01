const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { filterProjectFiles, listProjectFiles, listProjectFilesAsync } = require('./project-files.cjs');
const { openPathInVsCode, openPathWithDefaultApp, openProjectDirectory, openTerminalInDirectory, resolveSessionFilePath } = require('./open-path.cjs');

test('lists project files and skips ignored directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-files-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'node_modules', 'pkg'), { recursive: true });
    fs.mkdirSync(path.join(root, '.git'));
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), '');
    fs.writeFileSync(path.join(root, 'README.md'), '');
    fs.writeFileSync(path.join(root, 'node_modules', 'pkg', 'index.js'), '');
    fs.writeFileSync(path.join(root, '.git', 'config'), '');
    assert.deepEqual(listProjectFiles(root, { fs, path }).sort(), ['README.md', 'src/App.tsx']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('lists project files asynchronously without changing filtering behavior', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-files-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'src', 'App.tsx'), '');
    fs.writeFileSync(path.join(root, 'README.md'), '');
    assert.deepEqual((await listProjectFilesAsync(root)).sort(), ['README.md', 'src/App.tsx']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('filters project files by fuzzy name and path', () => {
  const files = ['src/App.tsx', 'src/renderer/App.tsx', 'electron/main.cjs', 'README.md'];
  assert.deepEqual(filterProjectFiles(files, 'app'), ['src/App.tsx', 'src/renderer/App.tsx']);
  assert.deepEqual(filterProjectFiles(files, 'electron/main'), ['electron/main.cjs']);
});

test('resolves relative session file paths', () => {
  assert.equal(
    resolveSessionFilePath('C:\\repo', 'src\\App.tsx', path),
    path.normalize('C:\\repo\\src\\App.tsx'),
  );
  assert.equal(
    resolveSessionFilePath('C:\\repo', 'C:\\repo\\src\\App.tsx', path),
    path.normalize('C:\\repo\\src\\App.tsx'),
  );
});

test('opens files with default app and vscode fallbacks', async () => {
  const opened = await openPathWithDefaultApp('C:\\repo\\a.ts', async () => '');
  assert.deepEqual(opened, { ok: true });
  const failed = await openPathWithDefaultApp('C:\\repo\\a.ts', async () => 'missing');
  assert.deepEqual(failed, { ok: false, error: 'missing' });

  const codeOk = await openPathInVsCode('C:\\repo\\a.ts', {
    spawn: () => {
      const handlers = {};
      return {
        on(event, callback) {
          handlers[event] = callback;
          if (event === 'exit') queueMicrotask(() => callback(0));
        },
      };
    },
    openExternal: async () => {
      throw new Error('should not open external');
    },
  });
  assert.deepEqual(codeOk, { ok: true });

  const externalOk = await openPathInVsCode('C:\\repo\\a.ts', {
    spawn: () => {
      const handlers = {};
      return {
        on(event, callback) {
          handlers[event] = callback;
          if (event === 'error') queueMicrotask(() => callback(new Error('no code')));
        },
      };
    },
    openExternal: async url => {
      assert.match(url, /^vscode:\/\/file\//);
    },
  });
  assert.deepEqual(externalOk, { ok: true });
});

test('opens an existing project directory in the system file manager', async () => {
  let openedPath;
  const result = await openProjectDirectory('C:\\repo', {
    fs: { statSync: () => ({ isDirectory: () => true }) },
    openPath: async value => {
      openedPath = value;
      return '';
    },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(openedPath, 'C:\\repo');

  const invalid = await openProjectDirectory('C:\\file', {
    fs: { statSync: () => ({ isDirectory: () => false }) },
  });
  assert.deepEqual(invalid, { ok: false, error: '项目目录不存在或不是目录。' });
});

test('starts Windows Terminal in an existing project directory and reports launch errors', async () => {
  const listeners = {};
  let command;
  let args;
  let spawnOptions;
  let unreferenced = false;
  const started = openTerminalInDirectory('C:\\repo', {
    fs: { statSync: () => ({ isDirectory: () => true }) },
    spawn: (receivedCommand, receivedArgs, receivedOptions) => {
      command = receivedCommand;
      args = receivedArgs;
      spawnOptions = receivedOptions;
      return {
        once(event, callback) { listeners[event] = callback; },
        unref() { unreferenced = true; },
      };
    },
  });
  listeners.spawn();
  assert.deepEqual(await started, { ok: true });
  assert.equal(command, 'wt.exe');
  assert.deepEqual(args, ['-w', 'new', '-d', 'C:\\repo']);
  assert.deepEqual(spawnOptions, { detached: true, shell: false, stdio: 'ignore' });
  assert.equal(unreferenced, true);

  const errorListeners = {};
  const failed = openTerminalInDirectory('C:\\repo', {
    fs: { statSync: () => ({ isDirectory: () => true }) },
    spawn: () => ({ once(event, callback) { errorListeners[event] = callback; } }),
  });
  errorListeners.error(new Error('Windows Terminal 未安装'));
  assert.deepEqual(await failed, { ok: false, error: 'Windows Terminal 未安装' });
});
