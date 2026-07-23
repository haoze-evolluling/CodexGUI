const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createSessionStore } = require('./session-store.cjs');

test('does not expose GUI session or archive persistence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-store-'));
  const store = createSessionStore(
    path.join(directory, 'sessions.json'),
    path.join(directory, 'archived-threads.json'),
  );
  try {
    assert.equal('loadSessions' in store, false);
    assert.equal('loadArchivedSessions' in store, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('does not create GUI session files', () => {
  const directory = path.join(os.tmpdir(), `missing-codex-gui-store-${Date.now()}`);
  const store = createSessionStore(
    path.join(directory, 'sessions.json'),
    path.join(directory, 'archived-threads.json'),
  );
  assert.equal(fs.existsSync(path.join(directory, 'sessions.json')), false);
  assert.equal(fs.existsSync(path.join(directory, 'archived-threads.json')), false);
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
    store.saveSettings({ codexPath: 'C:\\Tools\\codex.exe', model: 'gpt-5' });
    assert.deepEqual(store.saveSettings({ permissionMode: 'yolo' }), {
      permissionMode: 'yolo', fontSize: 'small', theme: 'light', historyRefreshIntervalSeconds: 10, codexPath: 'C:\\Tools\\codex.exe', model: 'gpt-5',
    });
    assert.deepEqual(store.saveSettings({ fontSize: 'large' }), {
      permissionMode: 'yolo', fontSize: 'large', theme: 'light', historyRefreshIntervalSeconds: 10, codexPath: 'C:\\Tools\\codex.exe', model: 'gpt-5',
    });
    assert.deepEqual(store.saveSettings({ theme: 'system' }), {
      permissionMode: 'yolo', fontSize: 'large', theme: 'system', historyRefreshIntervalSeconds: 10, codexPath: 'C:\\Tools\\codex.exe', model: 'gpt-5',
    });
    assert.deepEqual(store.saveSettings({ codexPath: '' }), { permissionMode: 'yolo', fontSize: 'large', theme: 'system', historyRefreshIntervalSeconds: 10, model: 'gpt-5' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('uses a ten-second default and normalizes the history refresh interval', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-refresh-settings-'));
  const store = createSessionStore(
    path.join(directory, 'sessions.json'),
    path.join(directory, 'archived-threads.json'),
    path.join(directory, 'settings.json'),
  );
  try {
    assert.equal(store.loadSettings().historyRefreshIntervalSeconds, 10);
    assert.equal(store.saveSettings({ historyRefreshIntervalSeconds: 2 }).historyRefreshIntervalSeconds, 5);
    assert.equal(store.saveSettings({ historyRefreshIntervalSeconds: 27.6 }).historyRefreshIntervalSeconds, 28);
    assert.equal(store.saveSettings({ historyRefreshIntervalSeconds: 7200 }).historyRefreshIntervalSeconds, 3600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
