const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createCodexAppServer } = require('./codex-app-server.cjs');

function harness() {
  const requests = [];
  const child = new EventEmitter();
  child.stdin = { writable: true, write(line) {
    const message = JSON.parse(line);
    if (!message.method) return true;
    requests.push(message);
    const data = message.method === 'initialize' ? {} : message.method === 'thread/list'
      ? { data: [{ id: 'thread-1', name: '归档测试', cwd: 'C:\\repo', updatedAt: '2026-08-10T00:00:00.000Z' }], nextCursor: null }
      : {};
    if (message.id !== undefined) queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, result: data })}\n`));
    return true;
  } };
  child.stdout = new PassThrough();
  child.kill = () => undefined;
  return { child, requests, server: createCodexAppServer({ getSpawnConfig: () => ({ command: 'codex', args: [], options: {} }), spawn: () => child }) };
}

test('lists archive metadata without reading conversation content', async () => {
  const { server, requests } = harness();
  assert.deepEqual(await server.listThreads(true), [{ id: 'codex-thread-1', threadId: 'thread-1', title: '归档测试', cwd: 'C:\\repo', updated: Date.parse('2026-08-10T00:00:00.000Z') }]);
  assert.deepEqual(requests.map(item => item.method), ['initialize', 'initialized', 'thread/list']);
});

test('supports unarchive and delete operations', async () => {
  const { server, requests } = harness();
  assert.equal(await server.restore('thread-1'), true);
  assert.equal(await server.remove('thread-1'), true);
  assert.deepEqual(requests.map(item => item.method), ['initialize', 'initialized', 'thread/unarchive', 'thread/delete']);
});

test('restarts the lightweight app-server connection', async () => {
  const { server, requests } = harness();
  assert.equal(await server.restart(), true);
  assert.deepEqual(requests.map(item => item.method), ['initialize', 'initialized']);
});
