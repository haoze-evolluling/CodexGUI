const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeSessions, parseSessionFile } = require('./codex-history.cjs');

test('reads a Codex session transcript and ignores malformed lines', () => {
  const filePath = path.join(os.tmpdir(), `codex-history-${Date.now()}.jsonl`);
  fs.writeFileSync(filePath, [
    JSON.stringify({ timestamp: '2026-07-20T02:00:00.000Z', type: 'session_meta', payload: { session_id: 'thread-1', cwd: 'C:\\project' } }),
    JSON.stringify({ timestamp: '2026-07-20T02:01:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'Fix the build' } }),
    '{bad json',
    JSON.stringify({ timestamp: '2026-07-20T02:02:00.000Z', type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Build fixed' }] } }),
  ].join('\n'));
  try {
    assert.deepEqual(parseSessionFile(filePath), {
      id: 'codex-thread-1', threadId: 'thread-1', cwd: 'C:\\project', title: 'Fix the build',
      messages: [{ role: 'user', text: 'Fix the build' }, { role: 'assistant', text: 'Build fixed' }],
      updated: Date.parse('2026-07-20T02:02:00.000Z'),
    });
  } finally { fs.unlinkSync(filePath); }
});

test('keeps saved GUI sessions when the imported thread is already present', () => {
  const saved = [{ id: 'gui-1', threadId: 'thread-1', updated: 1 }];
  const imported = [{ id: 'codex-thread-1', threadId: 'thread-1', updated: 3 }, { id: 'codex-thread-2', threadId: 'thread-2', updated: 2 }];
  assert.deepEqual(mergeSessions(saved, imported), [imported[1], saved[0]]);
});

test('uses a Chinese title when a transcript has no user message', () => {
  const filePath = path.join(os.tmpdir(), `codex-history-empty-${Date.now()}.jsonl`);
  fs.writeFileSync(filePath, JSON.stringify({ type: 'session_meta', payload: { session_id: 'thread-empty' } }));
  try { assert.equal(parseSessionFile(filePath).title, '未命名对话'); }
  finally { fs.unlinkSync(filePath); }
});
