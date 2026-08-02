const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');

function createHarness({ archived = [], archive = async () => true, cache = {}, codexHome = 'C:\\codex', readThread = async () => null, remove = async () => true, rollback = async () => null, sessions = [] } = {}) {
  const handlers = new Map();
  const savedSettings = [];
  const settings = { projectPaths: ['C:\\repo', 'C:\\other'] };
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const codexProcess = {
    archive,
    answerUserInput: () => false,
    compact: async () => false,
    listCollaborationModes: async () => [],
    listModels: async () => [],
    listSkills: async () => [],
    listThreads: async isArchived => isArchived ? archived : sessions,
    readThread,
    reload: () => true,
    remove,
    restore: async () => true,
    rollback,
    start: async () => true,
    stop: async () => true,
  };
  const store = {
    tokenUsageCache: { ...cache },
    loadSessionTitles: () => ({}),
    loadSettings: () => settings,
    saveSessionTitle: () => ({}),
    loadTokenUsageCache() { return this.tokenUsageCache; },
    saveTokenUsage(threadId, usage) { this.tokenUsageCache[threadId] = usage; },
    removeTokenUsage(threadIds) {
      for (const threadId of Array.isArray(threadIds) ? threadIds : [threadIds]) delete this.tokenUsageCache[threadId];
    },
    saveSettings: update => {
      savedSettings.push(update);
      Object.assign(settings, update);
      return settings;
    },
  };

  registerIpcHandlers({
    codexHome,
    codexProcess,
    dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
    getInstallation: () => ({ status: 'ready' }),
    getWindow: () => undefined,
    ipcMain,
    providerManager: {
      get: () => ({ activeId: '', model: '', reasoningEffort: '', providers: [] }),
      save: () => ({ activeId: '', model: '', reasoningEffort: '', providers: [] }),
      activate: () => ({ activeId: '', model: '', reasoningEffort: '', providers: [] }),
      remove: () => ({ activeId: '', model: '', reasoningEffort: '', providers: [] }),
    },
    store,
  });
  return { handlers, savedSettings, store };
}

test('registers the established IPC channels in their existing order', () => {
  const { handlers } = createHarness();
  assert.deepEqual([...handlers.keys()], [
    'window:minimize', 'window:toggle-maximize', 'window:close',
    'sessions:list', 'sessions:history', 'sessions:read', 'sessions:titles-list', 'sessions:title-save',
    'settings:get', 'settings:save', 'codex:installation', 'codex:path-save',
    'sessions:archive', 'sessions:archived-list', 'sessions:restore', 'sessions:archived-remove', 'sessions:archived-clear',
    'projects:delete', 'providers:get', 'providers:save', 'providers:activate', 'providers:delete',
    'dialog:folder', 'dialog:files', 'dialog:codex-executable',
    'files:list-project', 'files:open', 'files:open-vscode', 'files:open-project-directory', 'files:open-terminal', 'files:filter', 'files:diff',
    'cli:start', 'cli:stop', 'cli:compact', 'cli:rollback', 'cli:models', 'cli:collaboration-modes', 'cli:skills', 'cli:answer-user-input',
  ]);
});

test('rolls back using the authoritative app-server transcript', async () => {
  const session = {
    id: 'codex-thread-1',
    threadId: 'thread-1',
    timeline: [{ id: 'user-1', type: 'message', role: 'user', text: 'Hello' }],
  };
  const { handlers } = createHarness({ rollback: async () => session });
  // The handler's Codex history lookup can legitimately find no local JSONL
  // record; it must still return the authoritative rollback result.
  const result = await handlers.get('cli:rollback')(undefined, 'session-1', 'thread-1');
  assert.deepEqual(result, session);
});

test('reads sessions from App Server and fills only missing token usage from cache', async () => {
  const session = { id: 'codex-thread-1', threadId: 'thread-1', timeline: [] };
  const usage = { reportedAt: 1 };
  const { handlers } = createHarness({ cache: { 'thread-1': usage }, readThread: async threadId => ({ ...session, readThreadId: threadId }) });
  assert.deepEqual(await handlers.get('sessions:read')(undefined, 'thread-1'), { ...session, readThreadId: 'thread-1', tokenUsage: usage });
});

test('supplements App Server sessions with command activities from the Codex transcript', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-history-commands-'));
  const sessionsDirectory = path.join(root, 'sessions', '2026', '07');
  fs.mkdirSync(sessionsDirectory, { recursive: true });
  fs.writeFileSync(path.join(sessionsDirectory, 'thread.jsonl'), [
    JSON.stringify({ timestamp: '2026-07-20T02:00:00.000Z', type: 'session_meta', payload: { session_id: 'thread-1', cwd: 'C:\\repo' } }),
    JSON.stringify({ timestamp: '2026-07-20T02:01:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: '检查项目' } }),
    JSON.stringify({ timestamp: '2026-07-20T02:02:00.000Z', type: 'response_item', payload: { id: 'call-1', type: 'command_execution', command: 'rg TODO', aggregated_output: 'src/app.ts: TODO' } }),
    JSON.stringify({ timestamp: '2026-07-20T02:03:00.000Z', type: 'response_item', payload: { id: 'assistant-1', type: 'agent_message', text: '已完成' } }),
  ].join('\n'));
  const session = {
    id: 'codex-thread-1',
    threadId: 'thread-1',
    timeline: [
      { id: 'user-1', type: 'message', role: 'user', text: '检查项目' },
      { id: 'assistant-1', type: 'message', role: 'assistant', text: '已完成' },
    ],
  };
  const { handlers } = createHarness({ codexHome: root, readThread: async () => session });
  try {
    const result = await handlers.get('sessions:read')(undefined, 'thread-1');
    assert.deepEqual(result.timeline, [
      { id: 'user-1', type: 'message', role: 'user', text: '检查项目' },
      { id: 'call-1', type: 'command', status: 'completed', command: 'rg TODO', commandType: '其他 · 搜索', output: 'src/app.ts: TODO', exitCode: undefined },
      { id: 'assistant-1', type: 'message', role: 'assistant', text: '已完成' },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reads token usage from the Codex transcript when no current report or cache exists', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-history-usage-'));
  const sessionsDirectory = path.join(root, 'sessions', '2026', '07');
  fs.mkdirSync(sessionsDirectory, { recursive: true });
  fs.writeFileSync(path.join(sessionsDirectory, 'thread.jsonl'), [
    JSON.stringify({ timestamp: '2026-07-20T02:00:00.000Z', type: 'session_meta', payload: { session_id: 'thread-1', cwd: 'C:\\repo' } }),
    JSON.stringify({ timestamp: '2026-07-20T02:01:00.000Z', type: 'event_msg', payload: { type: 'token_count', info: {
      last_token_usage: { input_tokens: 20, total_tokens: 20 },
      total_token_usage: { input_tokens: 100, total_tokens: 100 },
      model_context_window: 258400,
    } } }),
  ].join('\n'));
  const session = { id: 'codex-thread-1', threadId: 'thread-1', timeline: [] };
  const { handlers, store } = createHarness({ codexHome: root, readThread: async () => session });
  try {
    const result = await handlers.get('sessions:read')(undefined, 'thread-1');
    assert.equal(result.tokenUsage.last.totalTokens, 20);
    assert.equal(result.tokenUsage.total.totalTokens, 100);
    assert.equal(result.tokenUsage.modelContextWindow, 258400);
    assert.equal(result.tokenUsage.reportedAt, Date.parse('2026-07-20T02:01:00.000Z'));
    assert.deepEqual(store.tokenUsageCache['thread-1'], result.tokenUsage);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('prefers current Codex token usage over the local cache without extra thread reads', async () => {
  const cached = { reportedAt: 1 };
  const current = { reportedAt: 2 };
  const { handlers, store } = createHarness({
    cache: { 'thread-1': cached },
    sessions: [{ id: 'codex-thread-1', threadId: 'thread-1', tokenUsage: current }],
  });
  assert.deepEqual(await handlers.get('sessions:history')(), [{ id: 'codex-thread-1', threadId: 'thread-1', tokenUsage: current }]);
  assert.equal(store.tokenUsageCache['thread-1'], current);
});

test('fills missing token usage for archived sessions from the cache', async () => {
  const usage = { reportedAt: 1 };
  const { handlers } = createHarness({
    archived: [{ id: 'codex-thread-1', threadId: 'thread-1' }],
    cache: { 'thread-1': usage },
  });
  assert.deepEqual(await handlers.get('sessions:archived-list')(), [{ id: 'codex-thread-1', threadId: 'thread-1', tokenUsage: usage }]);
});

test('archives only a thread confirmed by the current app-server', async () => {
  let archiveCalls = 0;
  const { handlers } = createHarness({
    sessions: [{ id: 'codex-thread-1', threadId: 'thread-1' }],
    archive: async threadId => {
      archiveCalls += 1;
      assert.equal(threadId, 'thread-1');
      return true;
    },
  });

  assert.deepEqual(await handlers.get('sessions:archive')(undefined, { threadId: 'thread-1' }), { ok: true });
  assert.equal(archiveCalls, 1);
});

test('rejects a stale thread after provider restart without sending thread/archive', async () => {
  let archiveCalls = 0;
  const { handlers } = createHarness({
    sessions: [],
    archive: async () => {
      archiveCalls += 1;
      return true;
    },
  });

  const result = await handlers.get('sessions:archive')(undefined, {
    id: 'codex-thread-1',
    threadId: 'thread-1',
  });

  assert.deepEqual(result, {
    ok: false,
    error: '该对话已不在当前提供商的会话列表中，请刷新会话列表后重试。',
  });
  assert.equal(archiveCalls, 0);
});

test('normalizes a rollout-not-found race into a recoverable archive error', async () => {
  const { handlers } = createHarness({
    sessions: [{ id: 'codex-thread-1', threadId: 'thread-1' }],
    archive: async () => { throw new Error('No roll out found for thread id thread-1'); },
  });

  assert.deepEqual(await handlers.get('sessions:archive')(undefined, { threadId: 'thread-1' }), {
    ok: false,
    error: '该对话已不在当前提供商的会话列表中，请刷新会话列表后重试。',
  });
});

test('clears token usage only after an archived thread is deleted by Codex', async () => {
  const { handlers, store } = createHarness({ cache: { 'thread-1': {} }, remove: async () => true });
  assert.deepEqual(await handlers.get('sessions:archived-remove')(undefined, { threadId: 'thread-1' }), { ok: true });
  assert.deepEqual(store.tokenUsageCache, {});
});

test('preserves partial success results while clearing archived sessions', async () => {
  const { handlers, store } = createHarness({
    archived: [{ threadId: 'thread-1' }, { threadId: 'thread-2' }],
    cache: { 'thread-1': {}, 'thread-2': {} },
    remove: async threadId => threadId === 'thread-1',
  });

  assert.deepEqual(await handlers.get('sessions:archived-clear')(), {
    ok: false,
    error: '部分归档对话未能删除。',
    succeededThreadIds: ['thread-1'],
  });
  assert.deepEqual(store.tokenUsageCache, { 'thread-2': {} });
});

test('removes a project from settings only after all its threads are deleted', async () => {
  const { handlers, savedSettings, store } = createHarness({ cache: { 'thread-1': {} } });
  assert.deepEqual(await handlers.get('projects:delete')(undefined, 'C:\\repo', [
    { id: 'session-1', threadId: 'thread-1', cwd: 'C:\\repo' },
  ]), { ok: true, succeededThreadIds: ['thread-1'] });
  assert.deepEqual(savedSettings, [{ projectPaths: ['C:\\other'] }]);
  assert.deepEqual(store.tokenUsageCache, {});
});
