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
      permissionMode: 'yolo', fontSize: 'small', theme: 'light', codexPath: 'C:\\Tools\\codex.exe', model: 'gpt-5',
    });
    assert.deepEqual(store.saveSettings({ fontSize: 'large' }), {
      permissionMode: 'yolo', fontSize: 'large', theme: 'light', codexPath: 'C:\\Tools\\codex.exe', model: 'gpt-5',
    });
    assert.deepEqual(store.saveSettings({ theme: 'system' }), {
      permissionMode: 'yolo', fontSize: 'large', theme: 'system', codexPath: 'C:\\Tools\\codex.exe', model: 'gpt-5',
    });
    assert.deepEqual(store.saveSettings({ codexPath: '' }), { permissionMode: 'yolo', fontSize: 'large', theme: 'system', model: 'gpt-5' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('restores the saved reasoning effort after reopening the store', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-reasoning-settings-'));
  const settingsFile = path.join(directory, 'settings.json');
  const createStore = () => createSessionStore(undefined, undefined, settingsFile);
  try {
    assert.equal(createStore().saveSettings({ reasoningEffort: 'high' }).reasoningEffort, 'high');
    assert.equal(createStore().loadSettings().reasoningEffort, 'high');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('does not persist the removed history refresh interval', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-refresh-settings-'));
  const store = createSessionStore(
    path.join(directory, 'sessions.json'),
    path.join(directory, 'archived-threads.json'),
    path.join(directory, 'settings.json'),
  );
  try {
    assert.equal('historyRefreshIntervalSeconds' in store.loadSettings(), false);
    assert.equal('historyRefreshIntervalSeconds' in store.saveSettings({ historyRefreshIntervalSeconds: 2 }), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('persists validated plan decision choices as UI state', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-plan-decisions-'));
  const store = createSessionStore(
    path.join(directory, 'sessions.json'),
    path.join(directory, 'archived-threads.json'),
    path.join(directory, 'settings.json'),
  );
  try {
    store.saveSettings({
      planDecisionChoices: {
        'thread-1:plan-decision-1': 'fresh',
        invalid: 'unsupported',
      },
    });
    assert.deepEqual(store.loadSettings().planDecisionChoices, {
      'thread-1:plan-decision-1': 'fresh',
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('persists user-provided titles by Codex thread id only', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-titles-'));
  const titlesFile = path.join(directory, 'session-titles.json');
  const store = createSessionStore(undefined, undefined, undefined, undefined, titlesFile);
  try {
    assert.deepEqual(store.loadSessionTitles(), {});
    assert.deepEqual(store.saveSessionTitle('thread-1', '  Local title  '), { 'thread-1': 'Local title' });
    assert.deepEqual(store.loadSessionTitles(), { 'thread-1': 'Local title' });
    assert.deepEqual(store.saveSessionTitle('', 'Ignored'), { 'thread-1': 'Local title' });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('persists only complete token usage snapshots by Codex thread id', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-token-usage-'));
  const cacheFile = path.join(directory, 'token-usage-cache.json');
  const store = createSessionStore(undefined, undefined, undefined, undefined, undefined, cacheFile);
  const usage = {
    last: { cachedInputTokens: 1, inputTokens: 2, outputTokens: 3, reasoningOutputTokens: 4, totalTokens: 10 },
    total: { cachedInputTokens: 5, inputTokens: 6, outputTokens: 7, reasoningOutputTokens: 8, totalTokens: 26 },
    modelContextWindow: 258400,
    reportedAt: 123,
  };
  try {
    assert.deepEqual(store.saveTokenUsage('thread-1', usage), { 'thread-1': usage });
    assert.deepEqual(store.loadTokenUsageCache(), { 'thread-1': usage });
    assert.deepEqual(store.saveTokenUsage('thread-2', { ...usage, reportedAt: undefined }), { 'thread-1': usage });
    assert.deepEqual(store.removeTokenUsage(['thread-1', 'missing']), {});
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('ignores malformed token usage cache files', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-invalid-token-usage-'));
  const cacheFile = path.join(directory, 'token-usage-cache.json');
  fs.writeFileSync(cacheFile, '{ not json');
  const store = createSessionStore(undefined, undefined, undefined, undefined, undefined, cacheFile);
  try {
    assert.deepEqual(store.loadTokenUsageCache(), {});
    fs.writeFileSync(cacheFile, JSON.stringify({ 'thread-1': { last: {}, total: {}, reportedAt: 1 } }));
    assert.deepEqual(store.loadTokenUsageCache(), {});
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
