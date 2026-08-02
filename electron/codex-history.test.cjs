const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichSessionWithCodexTranscript, loadCodexSession, parseSessionFile } = require('./codex-history.cjs');

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

test('restores native plan records as conversational text and a plan decision', () => {
  const filePath = path.join(os.tmpdir(), `codex-history-plan-${Date.now()}.jsonl`);
  fs.writeFileSync(filePath, [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 'thread-plan', cwd: 'C:\\project' } }),
    JSON.stringify({ type: 'response_item', payload: { id: 'plan-1', type: 'plan', text: 'Implementation plan' } }),
  ].join('\n'));
  try {
    const session = parseSessionFile(filePath);
    assert.deepEqual(session.messages, [{ role: 'assistant', text: 'Implementation plan' }]);
    assert.deepEqual(session.timeline, [
      { id: 'plan-1', type: 'message', role: 'assistant', text: 'Implementation plan' },
      { id: 'plan-decision-plan-1', type: 'plan_decision', status: 'pending', plan: 'Implementation plan' },
    ]);
  } finally { fs.unlinkSync(filePath); }
});

test('removes commands and messages from turns marked as rolled back in the Codex transcript', () => {
  const filePath = path.join(os.tmpdir(), `codex-history-rollback-${Date.now()}.jsonl`);
  fs.writeFileSync(filePath, [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 'thread-rollback', cwd: 'C:\\project' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'A' } }),
    JSON.stringify({ type: 'response_item', payload: { id: 'call-a', type: 'command_execution', command: 'rg A' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'agent_message', text: 'A done' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'B' } }),
    JSON.stringify({ type: 'response_item', payload: { id: 'call-b', type: 'command_execution', command: 'rg B' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'agent_message', text: 'B done' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'thread_rolled_back', num_turns: 1 } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: 'C' } }),
    JSON.stringify({ type: 'response_item', payload: { id: 'call-c', type: 'command_execution', command: 'rg C' } }),
  ].join('\n'));
  try {
    assert.deepEqual(parseSessionFile(filePath).timeline, [
      { id: 'message-0', type: 'message', role: 'user', text: 'A' },
      { id: 'call-a', type: 'command', status: 'completed', command: 'rg A', commandType: '其他 · 搜索', output: '', exitCode: undefined },
      { id: 'message-2', type: 'message', role: 'assistant', text: 'A done' },
      { id: 'message-3', type: 'message', role: 'user', text: 'C' },
      { id: 'call-c', type: 'command', status: 'completed', command: 'rg C', commandType: '其他 · 搜索', output: '', exitCode: undefined },
    ]);
  } finally { fs.unlinkSync(filePath); }
});

test('merges all JSONL fragments for the same thread in record-time order', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-history-fragments-'));
  const sessions = path.join(root, 'sessions', '2026', '07');
  fs.mkdirSync(sessions, { recursive: true });
  const first = [
    JSON.stringify({ timestamp: '2026-07-20T02:00:00.000Z', type: 'session_meta', payload: { session_id: 'thread-fragments', cwd: 'C:\\project' } }),
    JSON.stringify({ timestamp: '2026-07-20T02:01:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'A' } }),
    JSON.stringify({ timestamp: '2026-07-20T02:02:00.000Z', type: 'response_item', payload: { id: 'call-a', type: 'command_execution', command: 'rg A' } }),
  ];
  const second = [
    first[0],
    JSON.stringify({ timestamp: '2026-07-20T02:03:00.000Z', type: 'response_item', payload: { type: 'agent_message', text: 'A done' } }),
    JSON.stringify({ timestamp: '2026-07-20T02:04:00.000Z', type: 'event_msg', payload: { type: 'user_message', message: 'B' } }),
    JSON.stringify({ timestamp: '2026-07-20T02:05:00.000Z', type: 'response_item', payload: { id: 'call-b', type: 'command_execution', command: 'rg B' } }),
  ];
  fs.writeFileSync(path.join(sessions, 'first.jsonl'), first.join('\n'));
  fs.writeFileSync(path.join(sessions, 'second.jsonl'), second.join('\n'));
  try {
    assert.deepEqual((await loadCodexSession(root, 'thread-fragments')).timeline, [
      { id: 'message-0', type: 'message', role: 'user', text: 'A' },
      { id: 'call-a', type: 'command', status: 'completed', command: 'rg A', commandType: '其他 · 搜索', output: '', exitCode: undefined },
      { id: 'message-2', type: 'message', role: 'assistant', text: 'A done' },
      { id: 'message-3', type: 'message', role: 'user', text: 'B' },
      { id: 'call-b', type: 'command', status: 'completed', command: 'rg B', commandType: '其他 · 搜索', output: '', exitCode: undefined },
    ]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('reads native function_call records as command activities with their output', () => {
  const filePath = path.join(os.tmpdir(), `codex-history-function-call-${Date.now()}.jsonl`);
  fs.writeFileSync(filePath, [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 'thread-fn', cwd: 'C:\\project' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: '跑一下命令' } }),
    JSON.stringify({ type: 'response_item', payload: { id: 'fc-1', call_id: 'call-1', type: 'function_call', name: 'shell_command', arguments: '{"command": "Get-ChildItem"}' } }),
    JSON.stringify({ type: 'response_item', payload: { id: 'fco-1', call_id: 'call-1', type: 'function_call_output', output: 'Exit code: 0\nOutput: ok' } }),
    JSON.stringify({ type: 'response_item', payload: { id: 'msg-1', type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '完成' }] } }),
  ].join('\n'));
  try {
    assert.deepEqual(parseSessionFile(filePath).timeline, [
      { id: 'message-0', type: 'message', role: 'user', text: '跑一下命令' },
      { id: 'call-1', type: 'command', status: 'completed', command: 'Get-ChildItem', commandType: 'PowerShell · 工具调用', output: 'Exit code: 0\nOutput: ok' },
      { id: 'message-2', type: 'message', role: 'assistant', text: '完成' },
    ]);
  } finally { fs.unlinkSync(filePath); }
});

test('reads called records and camel-case tool outputs as command activities', () => {
  const filePath = path.join(os.tmpdir(), 'codex-history-called-' + Date.now() + '.jsonl');
  fs.writeFileSync(filePath, [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 'thread-called', cwd: 'C:\\project' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'user_message', message: '查看状态' } }),
    JSON.stringify({ type: 'response_item', payload: { id: 'called-1', type: 'called', name: 'shell_command', arguments: '{"cmd":"git status"}' } }),
    JSON.stringify({ type: 'response_item', payload: { id: 'output-1', callId: 'called-1', type: 'calledOutput', output: [{ text: 'clean' }] } }),
  ].join('\n'));
  try {
    assert.deepEqual(parseSessionFile(filePath).timeline, [
      { id: 'message-0', type: 'message', role: 'user', text: '查看状态' },
      { id: 'called-1', type: 'command', status: 'completed', command: 'git status', commandType: 'Git · 查询状态', output: 'clean' },
    ]);
  } finally { fs.unlinkSync(filePath); }
});

test('extracts and classifies the inner command from custom_tool_call history', () => {
  const filePath = path.join(os.tmpdir(), 'codex-history-custom-tool-' + Date.now() + '.jsonl');
  fs.writeFileSync(filePath, [
    JSON.stringify({ type: 'session_meta', payload: { session_id: 'thread-custom', cwd: 'C:\\project' } }),
    JSON.stringify({ type: 'response_item', payload: {
      id: 'custom-1', call_id: 'call-custom', type: 'custom_tool_call', name: 'shell_command',
      input: 'const result = await tools.shell_command({ command: "git status" });',
    } }),
  ].join('\n'));
  try {
    assert.deepEqual(parseSessionFile(filePath).timeline, [
      { id: 'call-custom', type: 'command', status: 'completed', command: 'git status', commandType: 'Git · 查询状态', output: '' },
    ]);
  } finally { fs.unlinkSync(filePath); }
});

test('supplements a thread/read response with function_call commands', () => {
  const session = {
    id: 'codex-thread-fn', threadId: 'thread-fn',
    timeline: [
      { id: 'item-1', type: 'message', role: 'user', text: '跑一下命令' },
      { id: 'item-2', type: 'message', role: 'assistant', text: '完成' },
    ],
  };
  const transcript = {
    threadId: 'thread-fn',
    messages: [{ role: 'user', text: '跑一下命令' }, { role: 'assistant', text: '完成' }],
    timeline: [
      { id: 'message-0', type: 'message', role: 'user', text: '跑一下命令' },
      { id: 'call-1', type: 'command', status: 'completed', command: 'Get-ChildItem', output: 'ok' },
      { id: 'message-1', type: 'message', role: 'assistant', text: '完成' },
    ],
  };
  assert.deepEqual(enrichSessionWithCodexTranscript(session, transcript).timeline, [
    { id: 'item-1', type: 'message', role: 'user', text: '跑一下命令' },
    { id: 'call-1', type: 'command', status: 'completed', command: 'Get-ChildItem', output: 'ok' },
    { id: 'item-2', type: 'message', role: 'assistant', text: '完成' },
  ]);
});

test('supplements a thread/read response without discarding App Server activity', () => {
  const session = {
    id: 'codex-thread-1', threadId: 'thread-1',
    timeline: [
      { id: 'user-1', type: 'message', role: 'user', text: '检查项目' },
      { id: 'file-1', type: 'file_change', status: 'completed', files: [{ path: 'src/app.ts', kind: 'update' }] },
    ],
  };
  const transcript = {
    threadId: 'thread-1',
    messages: [{ role: 'user', text: '检查项目' }, { role: 'assistant', text: '已完成' }],
    timeline: [
      { id: 'user-1', type: 'message', role: 'user', text: '检查项目' },
      { id: 'call-1', type: 'command', status: 'completed', command: 'rg TODO', output: 'src/app.ts: TODO' },
      { id: 'assistant-1', type: 'message', role: 'assistant', text: '已完成' },
    ],
  };
  assert.deepEqual(enrichSessionWithCodexTranscript(session, transcript).timeline, [
    { id: 'user-1', type: 'message', role: 'user', text: '检查项目' },
    { id: 'file-1', type: 'file_change', status: 'completed', files: [{ path: 'src/app.ts', kind: 'update' }] },
    { id: 'call-1', type: 'command', status: 'completed', command: 'rg TODO', output: 'src/app.ts: TODO' },
  ]);
});

test('does not restore commands from a turn removed by rollback', () => {
  const session = {
    id: 'codex-thread-1', threadId: 'thread-1',
    timeline: [
      { id: 'user-1', type: 'message', role: 'user', text: '检查项目' },
      { id: 'assistant-1', type: 'message', role: 'assistant', text: '已完成' },
    ],
  };
  const transcript = {
    threadId: 'thread-1',
    timeline: [
      { id: 'user-1', type: 'message', role: 'user', text: '检查项目' },
      { id: 'call-1', type: 'command', status: 'completed', command: 'rg TODO', output: 'src/app.ts: TODO' },
      { id: 'assistant-1', type: 'message', role: 'assistant', text: '已完成' },
      { id: 'user-2', type: 'message', role: 'user', text: '撤销这一轮' },
      { id: 'call-2', type: 'command', status: 'completed', command: 'git status', output: 'M src/app.ts' },
      { id: 'assistant-2', type: 'message', role: 'assistant', text: '这轮将被撤销' },
    ],
  };
  assert.deepEqual(enrichSessionWithCodexTranscript(session, transcript, { limitToSessionMessages: true }).timeline, [
    { id: 'user-1', type: 'message', role: 'user', text: '检查项目' },
    { id: 'call-1', type: 'command', status: 'completed', command: 'rg TODO', output: 'src/app.ts: TODO' },
    { id: 'assistant-1', type: 'message', role: 'assistant', text: '已完成' },
  ]);
});

test('does not replace the current branch with records left by a rolled-back turn', () => {
  const session = {
    id: 'codex-thread-1', threadId: 'thread-1',
    timeline: [
      { id: 'user-1', type: 'message', role: 'user', text: 'A' },
      { id: 'assistant-1', type: 'message', role: 'assistant', text: 'A done' },
      { id: 'user-3', type: 'message', role: 'user', text: 'C' },
      { id: 'assistant-3', type: 'message', role: 'assistant', text: 'C done' },
    ],
  };
  const transcript = {
    timeline: [
      { id: 'user-1', type: 'message', role: 'user', text: 'A' },
      { id: 'call-1', type: 'command', status: 'completed', command: 'one', output: '' },
      { id: 'assistant-1', type: 'message', role: 'assistant', text: 'A done' },
      { id: 'user-2', type: 'message', role: 'user', text: 'B' },
      { id: 'assistant-2', type: 'message', role: 'assistant', text: 'B done' },
      { id: 'user-3', type: 'message', role: 'user', text: 'C' },
      { id: 'assistant-3', type: 'message', role: 'assistant', text: 'C done' },
    ],
  };
  assert.deepEqual(enrichSessionWithCodexTranscript(session, transcript).timeline, session.timeline);
});

test('supplements only missing activities without replacing App Server messages', () => {
  const session = {
    id: 'codex-thread-1', threadId: 'thread-1',
    timeline: [
      { id: 'user-1', type: 'message', role: 'user', text: 'A' },
      { id: 'assistant-1', type: 'message', role: 'assistant', text: 'A done' },
      { id: 'new-item', type: 'user_input', status: 'pending', questions: [] },
    ],
  };
  const transcript = {
    timeline: [
      { id: 'user-1', type: 'message', role: 'user', text: 'A' },
      { id: 'call-1', type: 'command', status: 'completed', command: 'one', output: '' },
      { id: 'assistant-1', type: 'message', role: 'assistant', text: 'A done' },
    ],
  };
  assert.deepEqual(enrichSessionWithCodexTranscript(session, transcript).timeline, [
    { id: 'user-1', type: 'message', role: 'user', text: 'A' },
    { id: 'call-1', type: 'command', status: 'completed', command: 'one', output: '' },
    { id: 'assistant-1', type: 'message', role: 'assistant', text: 'A done' },
    { id: 'new-item', type: 'user_input', status: 'pending', questions: [] },
  ]);
});
