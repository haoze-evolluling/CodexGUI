const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const { createSessionStore } = require('./session-store.cjs');

test('reads only the internal Codex executable override', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-store-'));
  const settingsFile = path.join(directory, 'settings.json');
  fs.writeFileSync(settingsFile, JSON.stringify({ codexPath: ' C:\\Tools\\codex.exe ', theme: 'dark' }));
  try {
    const store = createSessionStore(undefined, undefined, settingsFile);
    assert.deepEqual(store.loadSettings(), { codexPath: 'C:\\Tools\\codex.exe', fontSize: 'medium', theme: 'dark' });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('persists normalized display settings', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-settings-'));
  const settingsFile = path.join(directory, 'settings.json');
  try {
    const store = createSessionStore(undefined, undefined, settingsFile);
    assert.deepEqual(store.saveSettings({ fontSize: 'large', theme: 'light' }), { fontSize: 'large', theme: 'light' });
    assert.deepEqual(store.loadSettings(), { fontSize: 'large', theme: 'light' });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('removes cached token usage for deleted archived threads', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-cache-'));
  const cacheFile = path.join(directory, 'token-usage.json');
  try {
    const store = createSessionStore(undefined, undefined, undefined, undefined, undefined, cacheFile);
    store.saveTokenUsage('thread-1', { total: 1 });
    store.saveTokenUsage('thread-2', { total: 2 });
    store.removeTokenUsage('thread-1');
    assert.deepEqual(store.loadTokenUsageCache(), { 'thread-2': { total: 2 } });
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
