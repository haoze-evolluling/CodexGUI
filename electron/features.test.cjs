const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const {
  cloneSessionSnapshot,
  normalizeArchivedSessions,
  removeArchivedSessionEntry,
  threadIdsFromArchivedSessions,
  upsertArchivedSession,
} = require('./codex-archive.cjs');
const { filterProjectFiles, listProjectFiles } = require('./project-files.cjs');
const { openPathInVsCode, openPathWithDefaultApp, resolveSessionFilePath } = require('./open-path.cjs');
const { createSessionStore } = require('./session-store.cjs');

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

test('archives session snapshots and supports restore/remove helpers', () => {
  let archived = [];
  archived = upsertArchivedSession(archived, {
    id: 's1',
    title: 'First',
    cwd: 'C:\\repo',
    threadId: 't1',
    timeline: [{ id: 'm1', type: 'message', role: 'user', text: 'hi' }],
    updated: 10,
  });
  assert.equal(archived.length, 1);
  assert.equal(archived[0].title, 'First');
  assert.deepEqual([...threadIdsFromArchivedSessions(archived)], ['t1']);

  archived = upsertArchivedSession(archived, {
    id: 's1',
    title: 'First updated',
    cwd: 'C:\\repo',
    threadId: 't1',
    updated: 20,
  });
  assert.equal(archived.length, 1);
  assert.equal(archived[0].title, 'First updated');

  archived = removeArchivedSessionEntry(archived, { threadId: 't1' });
  assert.equal(archived.length, 0);
  assert.equal(cloneSessionSnapshot({ id: '' }), null);
  assert.equal(normalizeArchivedSessions([{ id: 'x', title: 'A' }])[0].title, 'A');
});

test('session store migrates legacy archived thread ids to snapshots', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-archive-store-'));
  try {
    fs.writeFileSync(path.join(directory, 'archived-threads.json'), JSON.stringify(['thread-legacy']));
    const store = createSessionStore(
      path.join(directory, 'sessions.json'),
      path.join(directory, 'archived-threads.json'),
      path.join(directory, 'settings.json'),
      path.join(directory, 'archived-sessions.json'),
    );
    const archived = store.loadArchivedSessions();
    assert.equal(archived.length, 1);
    assert.equal(archived[0].threadId, 'thread-legacy');
    store.saveArchivedSessions(upsertArchivedSession(archived, {
      id: 'session-1',
      title: 'Recovered',
      cwd: 'C:\\repo',
      threadId: 'thread-legacy',
      updated: 1,
    }));
    assert.equal(store.loadArchivedSessions()[0].title, 'Recovered');
    assert.deepEqual([...store.loadArchivedThreads()], ['thread-legacy']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
