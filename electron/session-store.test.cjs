const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createSessionStore } = require('./session-store.cjs');

test('persists sessions and archived thread ids independently', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-store-'));
  const store = createSessionStore(
    path.join(directory, 'sessions.json'),
    path.join(directory, 'archived-threads.json'),
  );
  try {
    store.saveSessions([{ id: 'session-1' }]);
    store.saveArchivedThreads(new Set(['thread-1']));
    assert.deepEqual(store.loadSessions(), [{ id: 'session-1' }]);
    assert.deepEqual([...store.loadArchivedThreads()], ['thread-1']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('uses empty collections when persisted files cannot be read', () => {
  const directory = path.join(os.tmpdir(), `missing-codex-gui-store-${Date.now()}`);
  const store = createSessionStore(
    path.join(directory, 'sessions.json'),
    path.join(directory, 'archived-threads.json'),
  );
  assert.deepEqual(store.loadSessions(), []);
  assert.deepEqual([...store.loadArchivedThreads()], []);
});

test('persists Codex path and merges partial setting updates', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-settings-'));
  const settingsFile = path.join(directory, 'settings.json');
  const store = createSessionStore(
    path.join(directory, 'sessions.json'),
    path.join(directory, 'archived-threads.json'),
    settingsFile,
  );
  try {
    store.saveSettings({ codexPath: 'C:\\Tools\\codex.exe' });
    assert.deepEqual(store.saveSettings({ permissionMode: 'yolo' }), {
      permissionMode: 'yolo', codexPath: 'C:\\Tools\\codex.exe',
    });
    assert.deepEqual(store.saveSettings({ codexPath: '' }), { permissionMode: 'yolo' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
