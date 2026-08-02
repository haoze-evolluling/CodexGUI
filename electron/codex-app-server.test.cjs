const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createCodexAppServer } = require('./codex-app-server.cjs');
const { activityFromItem } = require('./codex-app-server-support.cjs');
const { inputFromOptions } = require('./codex-app-server-input.cjs');
const { createThreadSessionMapper } = require('./codex-app-server-sessions.cjs');
const { normalizeTokenUsage } = require('./codex-token-usage.cjs');

function createServerHarness({ attachDiffs = async () => [], interruptError, saveTokenUsage } = {}) {
  const requests = [];
  const events = [];
  const child = new EventEmitter();
  child.stdin = {
    writable: true,
    write(line) {
      const message = JSON.parse(line);
      if (message.method) requests.push(message);
      const results = {
        initialize: {},
        'thread/start': { thread: { id: 'thread-1' } },
        'turn/start': { turn: { id: 'turn-1' } },
        'turn/interrupt': {},
        'thread/compact/start': {},
        'thread/rollback': {},
        'thread/list': { data: [{ id: 'thread-1' }], nextCursor: null },
        'thread/read': {
          thread: {
            id: 'thread-1', cwd: 'C:\\repo', name: 'Thread', updatedAt: '2026-07-25T00:00:00.000Z',
            turns: [{ items: [
              { id: 'tool-1', type: 'customToolCall', status: 'completed', callId: 'call-1', name: 'shell_command', input: 'rg TODO' },
              { id: 'tool-output-1', type: 'customToolCallOutput', callId: 'call-1', output: [{ text: 'src/app.ts: TODO' }] },
              { id: 'change-1', type: 'fileChange', status: 'completed', changes: [{ path: 'src/app.ts', kind: 'update' }] },
            ] }],
          },
        },
        'thread/archive': {},
        'thread/unarchive': {},
        'thread/delete': {},
      };
      if (message.id !== undefined && message.method === 'turn/interrupt' && interruptError) {
        queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, error: { message: interruptError } })}\n`));
      } else if (message.id !== undefined && Object.hasOwn(results, message.method)) {
        queueMicrotask(() => child.stdout.write(`${JSON.stringify({ id: message.id, result: results[message.method] })}\n`));
      }
      return true;
    },
  };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => undefined;

  const server = createCodexAppServer({
    attachDiffs,
    getSpawnConfig: () => ({ command: 'codex', args: [], options: {} }),
    saveTokenUsage,
    send: (channel, value) => events.push({ channel, value }),
    spawn: () => child,
  });
  return { child, events, requests, server };
}

test('builds app-server input from skills and usable attachments only', () => {
  assert.deepEqual(inputFromOptions({
    prompt: '',
    skill: { name: 'review', path: 'C:\\skills\\review' },
    attachments: [
      null,
      { path: '   ', kind: 'code' },
      { path: 'C:\\repo\\note.md', kind: 'code' },
    ],
  }), [
    { type: 'skill', name: 'review', path: 'C:\\skills\\review' },
    { type: 'text', text: 'The following local files are part of this request.\n\nRead and use them as context before producing any response.\n\nFiles:\n- C:\\repo\\note.md' },
    { type: 'mention', name: 'C:\\repo\\note.md', path: 'C:\\repo\\note.md' },
  ]);
});

test('maps completed thread turns and enriches completed file changes', async () => {
  const mapper = createThreadSessionMapper({
    activityFromItem: item => item.type === 'fileChange'
      ? { id: item.id, type: 'file_change', status: item.status, files: item.changes }
      : null,
    attachDiffs: async (cwd, files) => files.map(file => ({ ...file, cwd })),
  });

  assert.deepEqual(await mapper.sessionFromThread({
    id: 'thread-1', preview: 'Preview', cwd: 'C:\\repo', updated_at: '2026-07-25T00:00:00.000Z',
    turns: [{ items: [
      { id: 'user-1', type: 'userMessage', content: [{ type: 'text', text: 'Hello' }] },
      { id: 'file-1', type: 'fileChange', status: 'completed', changes: [{ path: 'a.js' }] },
    ] }],
  }), {
    id: 'codex-thread-1',
    threadId: 'thread-1',
    cwd: 'C:\\repo',
    title: 'Preview',
    updated: Date.parse('2026-07-25T00:00:00.000Z'),
    timeline: [
      { id: 'user-1', type: 'message', role: 'user', text: 'Hello' },
      { id: 'file-1', type: 'file_change', status: 'completed', files: [{ path: 'a.js', cwd: 'C:\\repo' }] },
    ],
  });
});

test('maps conversation commands to their Codex app-server methods', async () => {
  const { child, requests, server } = createServerHarness();
  const options = {
    sessionId: 'session-1',
    cwd: 'C:\\repo',
    prompt: 'Hello',
    attachments: [],
    permissionMode: 'yolo',
  };

  assert.equal(await server.start(options), true);
  assert.equal(await server.stop('session-1'), true);
  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } } })}\n`);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(await server.compact('session-1', 'thread-1'), true);
  assert.equal((await server.rollback('session-1', 'thread-1')).threadId, 'thread-1');
  assert.equal(await server.archive('thread-1'), true);
  assert.equal(await server.restore('thread-1'), true);
  assert.equal(await server.remove('thread-1'), true);

  assert.deepEqual(
    requests.map(request => request.method).filter(Boolean),
    ['initialize', 'initialized', 'thread/start', 'turn/start', 'turn/interrupt', 'thread/read', 'thread/compact/start', 'thread/rollback', 'thread/read', 'thread/archive', 'thread/unarchive', 'thread/delete'],
  );
  const turn = requests.find(request => request.method === 'turn/start');
  assert.deepEqual(turn.params.input, [{ type: 'text', text: 'Hello' }]);
  assert.deepEqual(turn.params.sandboxPolicy, { type: 'dangerFullAccess' });
});

test('waits for turn completion when interrupt reports no active turn', async () => {
  const { child, events, server } = createServerHarness({ interruptError: 'no active turn to interrupt' });
  const options = {
    sessionId: 'session-1',
    cwd: 'C:\\repo',
    prompt: 'Hello',
    attachments: [],
    permissionMode: 'yolo',
  };

  assert.equal(await server.start(options), true);
  assert.equal(await server.stop('session-1'), true);
  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' },
  } })}\n`);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, [
    { channel: 'cli:thread', value: { sessionId: 'session-1', threadId: 'thread-1' } },
    { channel: 'cli:token-usage-pending', value: { sessionId: 'session-1' } },
    { channel: 'cli:exit', value: { sessionId: 'session-1', status: 'interrupted', hasPlan: false, hadError: false } },
  ]);
});

test('maps functionCall, toolCall, and called items to command activities', () => {
  assert.deepEqual(activityFromItem({ id: 'function-1', type: 'functionCall', name: 'shell_command', arguments: '{"command":"Get-ChildItem"}' }, 'completed'), {
    id: 'function-1', type: 'command', status: 'completed', command: 'Get-ChildItem', output: '',
  });
  assert.deepEqual(activityFromItem({ id: 'tool-1', type: 'tool_call', toolName: 'shell_command', input: { command: ['rg', 'TODO'] } }, 'completed', [{ text: 'ok' }]), {
    id: 'tool-1', type: 'command', status: 'completed', command: 'rg TODO', output: 'ok',
  });
  assert.deepEqual(activityFromItem({ id: 'called-1', type: 'called', cmd: 'git status' }, 'running'), {
    id: 'called-1', type: 'command', status: 'running', command: 'git status', output: '',
  });
});

test('maps token usage returned with a thread snapshot', async () => {
  const mapper = createThreadSessionMapper({ activityFromItem: () => null, attachDiffs: async (_, files) => files });
  const session = await mapper.sessionFromThread({
    id: 'thread-usage', cwd: 'C:\\repo', tokenUsage: {
      last: { cachedInputTokens: 1, inputTokens: 2, outputTokens: 3, reasoningOutputTokens: 4, totalTokens: 10 },
      total: { cachedInputTokens: 5, inputTokens: 6, outputTokens: 7, reasoningOutputTokens: 8, totalTokens: 26 },
      modelContextWindow: 258400,
    },
  });
  assert.equal(session.tokenUsage.last.totalTokens, 10);
  assert.equal(session.tokenUsage.total.totalTokens, 26);
  assert.equal(session.tokenUsage.modelContextWindow, 258400);
  assert.ok(Number.isFinite(session.tokenUsage.reportedAt));
});

test('normalizes app-server token usage without a reported context window', () => {
  const usage = normalizeTokenUsage({
    last_token_usage: { input_tokens: 4, total_tokens: 4 },
    total_token_usage: { input_tokens: 9, total_tokens: 9 },
  }, 123);
  assert.deepEqual(usage, {
    last: { cachedInputTokens: 0, inputTokens: 4, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 4 },
    total: { cachedInputTokens: 0, inputTokens: 9, outputTokens: 0, reasoningOutputTokens: 0, totalTokens: 9 },
    modelContextWindow: null,
    reportedAt: 123,
  });
});

test('coalesces streamed deltas and flushes the final message immediately', async () => {
  const { child, events, server } = createServerHarness();
  assert.equal(await server.start({ sessionId: 'session-1', cwd: 'C:\\repo', prompt: 'Hello', attachments: [], permissionMode: 'yolo' }), true);
  child.stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', itemId: 'message-1', delta: 'Hel' } })}\n`);
  child.stdout.write(`${JSON.stringify({ method: 'item/agentMessage/delta', params: { threadId: 'thread-1', itemId: 'message-1', delta: 'lo' } })}\n`);
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.deepEqual(events.slice(-1), [{ channel: 'cli:data', value: { sessionId: 'session-1', itemId: 'message-1', text: 'Hello' } }]);

  child.stdout.write(`${JSON.stringify({ method: 'item/completed', params: { threadId: 'thread-1', item: { id: 'message-1', type: 'agentMessage', text: 'Hello world' } } })}\n`);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.slice(-1), [{ channel: 'cli:data', value: { sessionId: 'session-1', itemId: 'message-1', text: 'Hello world', full: true } }]);
});

test('forwards token usage updates and requests a fresh snapshot after completion', async () => {
  const { child, events, requests, server } = createServerHarness();
  assert.equal(await server.start({ sessionId: 'session-1', cwd: 'C:\\repo', prompt: 'Hello', attachments: [], permissionMode: 'yolo' }), true);

  child.stdout.write(`${JSON.stringify({ method: 'thread/tokenUsage/updated', params: {
    threadId: 'thread-1', tokenUsage: {
      last: { inputTokens: 3, totalTokens: 3 }, total: { inputTokens: 5, totalTokens: 5 },
    },
  } })}\n`);
  await new Promise(resolve => setImmediate(resolve));
  const usageEvent = events.find(event => event.channel === 'cli:token-usage');
  assert.equal(usageEvent.value.tokenUsage.last.totalTokens, 3);
  assert.equal(usageEvent.value.tokenUsage.modelContextWindow, null);

  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' },
  } })}\n`);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(events.some(event => event.channel === 'cli:token-usage-pending'));
  assert.ok(requests.some(request => request.method === 'thread/read' && request.params.includeTurns === false));
});

test('persists only token usage reported by Codex', async () => {
  const saved = [];
  const { child, server } = createServerHarness({ saveTokenUsage: (threadId, usage) => saved.push({ threadId, usage }) });
  assert.equal(await server.start({ sessionId: 'session-1', cwd: 'C:\\repo', prompt: 'Hello', attachments: [], permissionMode: 'yolo' }), true);
  child.stdout.write(`${JSON.stringify({ method: 'thread/tokenUsage/updated', params: {
    threadId: 'thread-1', tokenUsage: { last: { inputTokens: 3, totalTokens: 3 }, total: { inputTokens: 5, totalTokens: 5 } },
  } })}\n`);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(saved.length, 1);
  assert.equal(saved[0].threadId, 'thread-1');
  assert.equal(saved[0].usage.total.totalTokens, 5);
});

test('does not answer a user-input request after its turn completes', async () => {
  const { child, server } = createServerHarness();
  assert.equal(await server.start({
    sessionId: 'session-1', cwd: 'C:\\repo', prompt: 'Hello', attachments: [], permissionMode: 'yolo',
  }), true);

  child.stdout.write(`${JSON.stringify({ id: 99, method: 'item/tool/requestUserInput', params: {
    threadId: 'thread-1', itemId: 'input-1', questions: [],
  } })}\n`);
  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' },
  } })}\n`);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(server.answerUserInput('input-1', {}), false);
});

test('rejects oversized input and unsafe attachment paths before starting a turn', () => {
  assert.throws(() => inputFromOptions({ prompt: 'x'.repeat(200_001), attachments: [] }), /输入内容过长/);
  assert.throws(() => inputFromOptions({
    prompt: '',
    attachments: Array.from({ length: 21 }, (_, index) => ({ path: `C:\\repo\\${index}.txt` })),
  }), /最多可添加 20 个附件/);
  assert.throws(() => inputFromOptions({
    prompt: '',
    attachments: [{ path: 'C:\\repo\\bad\nname.txt' }],
  }), /控制字符/);
});

test('ignores turn completion notifications without an id', async () => {
  const { child, events, server } = createServerHarness();
  const options = {
    sessionId: 'session-1',
    cwd: 'C:\\repo',
    prompt: 'Hello',
    attachments: [],
    permissionMode: 'yolo',
  };

  assert.equal(await server.start(options), true);
  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'thread-1', turn: { status: 'interrupted' },
  } })}\n`);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(events, [
    { channel: 'cli:thread', value: { sessionId: 'session-1', threadId: 'thread-1' } },
  ]);

  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'thread-1', turn: { id: 'turn-1', status: 'interrupted' },
  } })}\n`);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events.slice(-1), [
    { channel: 'cli:exit', value: { sessionId: 'session-1', status: 'interrupted', hasPlan: false, hadError: false } },
  ]);
});

test('publishes a plan decision when plan mode completes as an agent message', async () => {
  const { child, events, server } = createServerHarness();

  assert.equal(await server.start({
    sessionId: 'session-1',
    cwd: 'C:\\repo',
    prompt: 'Create a plan',
    attachments: [],
    collaborationMode: { mode: 'plan' },
    permissionMode: 'yolo',
  }), true);

  child.stdout.write(`${JSON.stringify({ method: 'item/completed', params: {
    threadId: 'thread-1',
    item: { id: 'plan-1', type: 'agentMessage', text: 'Implementation plan' },
  } })}\n`);
  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' },
  } })}\n`);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(events.slice(-2), [
    { channel: 'cli:plan-ready', value: { sessionId: 'session-1', plan: { itemId: 'plan-1', text: 'Implementation plan' } } },
    { channel: 'cli:exit', value: { sessionId: 'session-1', status: 'completed', hasPlan: true, hadError: false } },
  ]);
});

test('publishes a plan decision for a native plan item without relying on mode bookkeeping', async () => {
  const { child, events, server } = createServerHarness();

  assert.equal(await server.start({
    sessionId: 'session-1', cwd: 'C:\\repo', prompt: 'Create a plan', attachments: [], permissionMode: 'yolo',
  }), true);

  child.stdout.write(`${JSON.stringify({ method: 'item/completed', params: {
    threadId: 'thread-1', item: { id: 'plan-1', type: 'plan', text: 'Implementation plan' },
  } })}\n`);
  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' },
  } })}\n`);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(events.slice(-2), [
    { channel: 'cli:plan-ready', value: { sessionId: 'session-1', plan: { itemId: 'plan-1', text: 'Implementation plan' } } },
    { channel: 'cli:exit', value: { sessionId: 'session-1', status: 'completed', hasPlan: true, hadError: false } },
  ]);
});

test('rejects a second start while the first start is still being created', async () => {
  const { requests, server } = createServerHarness();
  const options = {
    sessionId: 'session-1', cwd: 'C:\\repo', prompt: 'Hello', attachments: [], permissionMode: 'yolo',
  };

  const first = server.start(options);
  assert.equal(await server.start(options), false);
  assert.equal(await first, true);
  assert.equal(requests.filter(request => request.method === 'turn/start').length, 1);
});

test('marks a completed turn with an error so the renderer retains the error message', async () => {
  const { child, events, server } = createServerHarness();

  assert.equal(await server.start({
    sessionId: 'session-1',
    cwd: 'C:\\repo',
    prompt: 'Run a task',
    attachments: [],
    permissionMode: 'yolo',
  }), true);

  child.stdout.write(`${JSON.stringify({ method: 'turn/completed', params: {
    threadId: 'thread-1', turn: { id: 'turn-1', status: 'failed', error: { message: 'Command failed' } },
  } })}\n`);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(events.slice(-3), [
    { channel: 'cli:error', value: { sessionId: 'session-1', error: 'Command failed' } },
    { channel: 'cli:token-usage-pending', value: { sessionId: 'session-1' } },
    { channel: 'cli:exit', value: { sessionId: 'session-1', status: 'failed', hasPlan: false, hadError: true } },
  ]);
});

test('sends selected files to Codex as mentions and explicit turn context', async () => {
  const { requests, server } = createServerHarness();

  assert.equal(await server.start({
    sessionId: 'session-1',
    cwd: 'C:\\repo',
    prompt: '请检查这些文件',
    attachments: [
      { name: 'app.ts', path: 'C:\\repo\\src\\app.ts', kind: 'code' },
      { name: 'diagram.png', path: 'C:\\repo\\diagram.png', kind: 'image' },
    ],
    permissionMode: 'yolo',
  }), true);

  const turn = requests.find(request => request.method === 'turn/start');
  assert.deepEqual(turn.params.input, [
    { type: 'text', text: '请检查这些文件\n\nThe following local files are part of this request.\n\nRead and use them as context before producing any response.\n\nFiles:\n- C:\\repo\\src\\app.ts\n- C:\\repo\\diagram.png' },
    { type: 'mention', name: 'app.ts', path: 'C:\\repo\\src\\app.ts' },
    { type: 'localImage', path: 'C:\\repo\\diagram.png' },
  ]);
});

test('keeps file diffs when a completed thread is read for history refresh', async () => {
  const { server } = createServerHarness({
    attachDiffs: async (cwd, files) => {
      assert.equal(cwd, 'C:\\repo');
      return files.map(file => ({ ...file, diff: 'diff --git a/src/app.ts b/src/app.ts\n+--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-old\n+new' }));
    },
  });

  const [session] = await server.listThreads(false, true);

  assert.deepEqual(session.timeline[0], {
    id: 'call-1', type: 'command', status: 'completed', command: 'rg TODO', output: 'src/app.ts: TODO',
  });
  assert.equal(session.timeline[1].type, 'file_change');
  assert.match(session.timeline[1].files[0].diff, /\+new/);
});

test('maps native plan items from thread/read into recoverable plan decisions', async () => {
  const mapper = createThreadSessionMapper({ activityFromItem: () => null, attachDiffs: async (_, files) => files });

  const session = await mapper.sessionFromThread({
    id: 'thread-1', cwd: 'C:\\repo', turns: [{ items: [
      { id: 'plan-1', type: 'plan', text: 'Implementation plan' },
    ] }],
  });

  assert.deepEqual(session.timeline, [
    { id: 'plan-1', type: 'message', role: 'assistant', text: 'Implementation plan' },
    { id: 'plan-decision-plan-1', type: 'plan_decision', status: 'pending', plan: 'Implementation plan' },
  ]);
});

test('keeps attachment-only user messages in a thread transcript', async () => {
  const mapper = createThreadSessionMapper({ activityFromItem: () => null, attachDiffs: async (_, files) => files });
  const session = await mapper.sessionFromThread({
    id: 'thread-1', cwd: 'C:\\repo', turns: [{ items: [
      { id: 'user-1', type: 'userMessage', content: [{ type: 'localImage', path: 'C:\\repo\\diagram.png' }] },
    ] }],
  });
  assert.deepEqual(session.timeline, [{
    id: 'user-1', type: 'message', role: 'user', text: '',
    attachments: [{ id: 'localImage-0-C:\\repo\\diagram.png', path: 'C:\\repo\\diagram.png', name: 'diagram.png', kind: 'image' }],
  }]);
});

test('lists thread metadata without reading every conversation', async () => {
  const { requests, server } = createServerHarness();

  const [session] = await server.listThreads(false);

  assert.equal(session.threadId, 'thread-1');
  assert.equal('timeline' in session, false);
  assert.equal(requests.some(request => request.method === 'thread/read'), false);
});
