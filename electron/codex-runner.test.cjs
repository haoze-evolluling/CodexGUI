const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCodexArgs, buildSpawnOptions, createDiagnostics, createEventParser, eventToMessage } = require('./codex-runner.cjs');
const { RequestManager } = require('./request-manager.cjs');

test('runs requests for separate sessions concurrently', () => {
  const manager = new RequestManager();
  const first = { kill() {} };
  const second = { kill() {} };
  assert.equal(manager.start('session-a', first), true);
  assert.equal(manager.start('session-b', second), true);
  assert.equal(manager.start('session-a', { kill() {} }), false);
});

test('stops only the request belonging to the requested session', () => {
  const manager = new RequestManager();
  let stopped = false;
  const child = { kill() { stopped = true; } };
  manager.start('session-a', child);
  assert.equal(manager.stop('session-b'), false);
  assert.equal(stopped, false);
  assert.equal(manager.stop('session-a'), true);
  assert.equal(stopped, true);
});

test('uses the non-interactive command for a new thread', () => {
  assert.deepEqual(buildCodexArgs('你好'), ['exec', '--json', '你好']);
});

test('resumes the Codex thread on later messages', () => {
  assert.deepEqual(buildCodexArgs('继续', 'thread-123'), [
    'exec', 'resume', '--json', 'thread-123', '继续',
  ]);
});

test('closes stdin because the prompt is passed as an argument', () => {
  assert.deepEqual(buildSpawnOptions('C:\\project').stdio, ['ignore', 'pipe', 'pipe']);
});

test('does not show stderr diagnostics after a successful run', () => {
  const diagnostics = createDiagnostics();
  diagnostics.add('Reading additional input from stdin...');
  assert.equal(diagnostics.errorForExit(0), null);
});

test('shows collected diagnostics after a failed run', () => {
  const diagnostics = createDiagnostics();
  diagnostics.add('Authentication failed');
  diagnostics.add('Run codex login');
  assert.equal(diagnostics.errorForExit(1), 'Authentication failed\nRun codex login');
});

test('parses chunked JSONL and extracts thread and assistant events', () => {
  const events = [];
  const parser = createEventParser(event => events.push(event));
  parser.push('{"type":"thread.started","thread_id":"abc"}\n{"type":');
  parser.push('"item.completed","item":{"type":"agent_message","text":"你好"}}\n');
  parser.end();

  assert.deepEqual(events.map(eventToMessage), [
    { threadId: 'abc' },
    { text: '你好' },
  ]);
});
