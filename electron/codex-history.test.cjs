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
      timeline: [
        { id: 'message-0', type: 'message', role: 'user', text: 'Fix the build' },
        { id: 'message-1', type: 'message', role: 'assistant', text: 'Build fixed' },
      ],
      updated: Date.parse('2026-07-20T02:02:00.000Z'),
    });
  } finally { fs.unlinkSync(filePath); }
});

test('keeps saved GUI sessions when the imported thread is already present', () => {
  const saved = [{ id: 'gui-1', threadId: 'thread-1', updated: 1 }];
  const imported = [{ id: 'codex-thread-1', threadId: 'thread-1', updated: 3 }, { id: 'codex-thread-2', threadId: 'thread-2', updated: 2 }];
  assert.deepEqual(mergeSessions(saved, imported), [imported[1], saved[0]]);
});

test('enriches a saved session when the Codex transcript has activity entries', () => {
  const saved = [{ id: 'gui-1', threadId: 'thread-1', messages: [{ role: 'user', text: 'Fix it' }], updated: 1 }];
  const imported = [{ id: 'codex-thread-1', threadId: 'thread-1', messages: [{ role: 'user', text: 'Fix it' }], timeline: [{ id: 'm-1', type: 'message', role: 'user', text: 'Fix it' }, { id: 'f-1', type: 'file_change', status: 'completed', files: [{ path: 'src/a.ts', kind: 'update' }] }], updated: 3 }];
  assert.deepEqual(mergeSessions(saved, imported), [{ ...saved[0], messages: imported[0].messages, timeline: imported[0].timeline, updated: 3 }]);
});

test('reads the latest token usage snapshot from a Codex transcript', () => {
  const filePath = path.join(os.tmpdir(), `codex-history-usage-${Date.now()}.jsonl`);
  const tokenCount = (totalTokens, lastTokens) => ({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: totalTokens - 10, cached_input_tokens: 5, output_tokens: 10, reasoning_output_tokens: 2, total_tokens: totalTokens },
        last_token_usage: { input_tokens: lastTokens - 3, cached_input_tokens: 1, output_tokens: 3, reasoning_output_tokens: 1, total_tokens: lastTokens },
        model_context_window: 258400,
      },
    },
  });
  fs.writeFileSync(filePath, [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 'thread-usage', cwd: 'C:\\project' } }),
    JSON.stringify(tokenCount(100, 40)),
    JSON.stringify(tokenCount(250, 80)),
  ].join('\n'));
  try {
    const session = parseSessionFile(filePath);
    assert.equal(session.tokenUsage.last.totalTokens, 80);
    assert.equal(session.tokenUsage.total.totalTokens, 250);
    assert.equal(session.tokenUsage.modelContextWindow, 258400);
  } finally { fs.unlinkSync(filePath); }
});

test('enriches a saved GUI session with imported token usage', () => {
  const tokenUsage = {
    last: { totalTokens: 80 }, total: { totalTokens: 250 }, modelContextWindow: 258400,
  };
  const saved = [{ id: 'gui-1', threadId: 'thread-1', timeline: [{ id: 'saved' }], updated: 3 }];
  const imported = [{ id: 'codex-thread-1', threadId: 'thread-1', timeline: [], tokenUsage, updated: 2 }];
  assert.deepEqual(mergeSessions(saved, imported), [{ ...saved[0], tokenUsage }]);
});

test('uses a Chinese title when a transcript has no user message', () => {
  const filePath = path.join(os.tmpdir(), `codex-history-empty-${Date.now()}.jsonl`);
  fs.writeFileSync(filePath, JSON.stringify({ type: 'session_meta', payload: { session_id: 'thread-empty' } }));
  try { assert.equal(parseSessionFile(filePath).title, '未命名对话'); }
  finally { fs.unlinkSync(filePath); }
});
