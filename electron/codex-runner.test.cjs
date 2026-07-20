const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCodexArgs, buildSpawnOptions, createDiagnostics, createEventParser, eventToMessage } = require('./codex-runner.cjs');

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
