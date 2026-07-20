const test = require('node:test');
const assert = require('node:assert/strict');
const { buildArchiveArgs, removeArchivedSessions } = require('./codex-archive.cjs');

test('builds the Codex archive command for an existing thread', () => {
  assert.deepEqual(buildArchiveArgs('thread-123'), ['archive', 'thread-123']);
});

test('removes saved copies by both GUI id and Codex thread id', () => {
  const sessions = [
    { id: 'gui-1', threadId: 'thread-1' },
    { id: 'imported-1', threadId: 'thread-1' },
    { id: 'gui-2', threadId: 'thread-2' },
  ];
  assert.deepEqual(removeArchivedSessions(sessions, sessions[0]), [sessions[2]]);
});

test('removes an unsent local session without matching unrelated threads', () => {
  const sessions = [
    { id: 'local-empty' },
    { id: 'gui-1', threadId: 'thread-1' },
  ];
  assert.deepEqual(removeArchivedSessions(sessions, sessions[0]), [sessions[1]]);
});
