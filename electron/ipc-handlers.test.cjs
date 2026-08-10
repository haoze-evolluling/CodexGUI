const assert = require('node:assert/strict');
const test = require('node:test');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');

function harness() {
  const handlers = new Map();
  const archived = [{ id: 'codex-thread-1', threadId: 'thread-1' }];
  const removed = [];
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const codexProcess = {
    listThreads: async () => archived,
    restore: async () => true,
    remove: async threadId => { removed.push(threadId); return true; },
  };
  const providerManager = {
    get: () => ({ activeId: 'p1', model: 'gpt-5', reasoningEffort: 'medium', providers: [] }),
    save: () => ({ activeId: 'p1', model: 'gpt-5', reasoningEffort: 'medium', providers: [] }),
    activate: async () => ({ activeId: 'p1', model: 'gpt-5', reasoningEffort: 'medium', providers: [] }),
    remove: () => ({ activeId: 'p1', model: 'gpt-5', reasoningEffort: 'medium', providers: [] }),
  };
  const cache = new Set();
  registerIpcHandlers({ codexProcess, ipcMain, providerManager, store: { removeTokenUsage: id => cache.delete(id) } });
  return { handlers, removed, cache };
}

test('registers only archive and provider management channels', () => {
  const { handlers } = harness();
  assert.deepEqual([...handlers.keys()], [
    'sessions:archived-list', 'sessions:restore', 'sessions:archived-remove', 'sessions:archived-clear',
    'providers:get', 'providers:save', 'providers:activate', 'providers:delete',
  ]);
});

test('delegates archive restore and removal', async () => {
  const { handlers, removed } = harness();
  assert.deepEqual(await handlers.get('sessions:restore')(undefined, { threadId: 'thread-1' }), { ok: true });
  assert.deepEqual(await handlers.get('sessions:archived-remove')(undefined, { threadId: 'thread-1' }), { ok: true });
  assert.deepEqual(removed, ['thread-1']);
});

test('rejects archive operations without a thread id', async () => {
  const { handlers } = harness();
  assert.deepEqual(await handlers.get('sessions:restore')(undefined, {}), { ok: false, error: '无效的归档对话。' });
  assert.deepEqual(await handlers.get('sessions:archived-remove')(undefined, {}), { ok: false, error: '无效的归档对话。' });
});
