const readline = require('readline');
const { activityFromItem, resolvePermissionSettings } = require('./codex-app-server-support.cjs');

function createCodexAppServer({ attachDiffs, getSpawnConfig, send, spawn }) {
  let child;
  let ready;
  let nextId = 1;
  const pending = new Map();
  const sessionsByThread = new Map();
  const threadsBySession = new Map();
  const turnsBySession = new Map();
  const userInputRequests = new Map();
  const completedPlans = new Map();

  function write(message) {
    if (!child?.stdin.writable) throw new Error('Codex app-server is not running.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method, params = {}) {
    const id = nextId++;
    write({ method, id, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  function sessionIdFor(threadId) {
    return sessionsByThread.get(threadId);
  }

  function emitForThread(channel, threadId, value = {}) {
    const sessionId = sessionIdFor(threadId);
    if (sessionId) send(channel, { sessionId, ...value });
  }

  async function emitActivity(threadId, activity) {
    const sessionId = sessionIdFor(threadId);
    if (!sessionId) return;
    send('cli:activity', { sessionId, activity });
    if (activity.type === 'file_change' && activity.status === 'completed') {
      const cwd = threadsBySession.get(sessionId)?.cwd || process.cwd();
      const files = await attachDiffs(cwd, activity.files);
      send('cli:activity', { sessionId, activity: { ...activity, files } });
    }
  }

  function handleNotification(message) {
    const params = message.params || {};
    if (message.method === 'skills/changed') {
      send('cli:skills-changed', {});
      return;
    }
    const threadId = params.threadId;
    if (message.method === 'item/agentMessage/delta' || message.method === 'item/plan/delta') {
      emitForThread('cli:data', threadId, { itemId: params.itemId, text: params.delta });
      return;
    }
    if (message.method === 'item/started' || message.method === 'item/completed') {
      const status = message.method === 'item/started' ? 'running' : 'completed';
      if (status === 'completed' && (params.item?.type === 'agentMessage' || params.item?.type === 'plan') && typeof params.item.text === 'string') {
        emitForThread('cli:data', threadId, { itemId: params.item.id, text: params.item.text, full: true });
      }
      if (status === 'completed' && params.item?.type === 'plan' && typeof params.item.text === 'string') {
        const sessionId = sessionIdFor(threadId);
        if (sessionId) completedPlans.set(sessionId, { itemId: params.item.id, text: params.item.text });
      }
      const activity = activityFromItem(params.item, status);
      if (activity) {
        emitActivity(threadId, activity);
        // App-server versions do not consistently emit thread/compacted. A completed
        // compaction item is the authoritative completion signal in that case.
        if (activity.type === 'compaction' && status === 'completed') {
          emitForThread('cli:compacted', threadId);
        }
      }
      return;
    }
    if (message.method === 'turn/started') {
      const sessionId = sessionIdFor(threadId);
      if (sessionId) {
        turnsBySession.set(sessionId, params.turn?.id);
        completedPlans.delete(sessionId);
      }
      return;
    }
    if (message.method === 'turn/completed') {
      const sessionId = sessionIdFor(threadId);
      if (!sessionId) return;
      turnsBySession.delete(sessionId);
      const error = params.turn?.error?.message;
      if (error) send('cli:error', { sessionId, error });
      const plan = completedPlans.get(sessionId);
      completedPlans.delete(sessionId);
      send('cli:exit', { sessionId, status: params.turn?.status });
      if (!error && plan) send('cli:plan-ready', { sessionId, plan });
      return;
    }
    if (message.method === 'thread/compacted') {
      emitForThread('cli:compacted', threadId);
      return;
    }
    if (message.method === 'thread/status/changed') {
      emitForThread('cli:status', threadId, { status: params.status });
      return;
    }
    if (message.method === 'thread/tokenUsage/updated') {
      emitForThread('cli:token-usage', threadId, { tokenUsage: params.tokenUsage });
    }
  }

  function handleServerRequest(message) {
    if (message.method !== 'item/tool/requestUserInput') {
      write({ id: message.id, error: { code: -32601, message: `Unsupported request: ${message.method}` } });
      return;
    }
    const sessionId = sessionIdFor(message.params?.threadId);
    if (!sessionId) {
      write({ id: message.id, error: { code: -32602, message: 'Unknown thread.' } });
      return;
    }
    userInputRequests.set(message.params.itemId, message.id);
    send('cli:user-input', { sessionId, request: message.params });
  }

  function handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && (message.result !== undefined || message.error)) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message || 'Codex request failed.'));
      else waiter.resolve(message.result);
      return;
    }
    if (message.id !== undefined && message.method) handleServerRequest(message);
    else if (message.method) handleNotification(message);
  }

  function startProcess() {
    const config = getSpawnConfig();
    child = spawn(config.command, config.args, config.options);
    readline.createInterface({ input: child.stdout }).on('line', handleLine);
    child.stderr.on('data', data => send('cli:server-error', { error: data.toString() }));
    child.on('error', failAll);
    child.on('close', code => failAll(new Error(`Codex app-server exited with code ${code}.`)));
    ready = request('initialize', {
      clientInfo: { name: 'codex_gui', title: 'Codex GUI', version: '0.1.10' },
      capabilities: { experimentalApi: true },
    }).then(result => {
      write({ method: 'initialized', params: {} });
      return result;
    });
    return ready;
  }

  function failAll(error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
    for (const sessionId of turnsBySession.keys()) send('cli:error', { sessionId, error: failure.message });
    turnsBySession.clear();
    completedPlans.clear();
    child = undefined;
    ready = undefined;
  }

  async function ensureReady() {
    return ready || startProcess();
  }

  async function ensureThread(options) {
    await ensureReady();
    const loaded = threadsBySession.get(options.sessionId);
    let threadId = loaded?.threadId;
    if (!threadId && options.threadId) {
      threadId = options.threadId;
      await request('thread/resume', { threadId });
    } else if (!threadId) {
      const result = await request('thread/start', {
        cwd: options.cwd,
        model: options.model || null,
        approvalPolicy: options.permissionSettings.approvalPolicy,
        sandbox: options.permissionSettings.sandbox,
      });
      threadId = result.thread.id;
    }
    sessionsByThread.set(threadId, options.sessionId);
    threadsBySession.set(options.sessionId, { threadId, cwd: options.cwd });
    send('cli:thread', { sessionId: options.sessionId, threadId });
    return threadId;
  }

  return {
    async start(options) {
      if (!options.sessionId || turnsBySession.has(options.sessionId)) return false;
      try {
        const permissionSettings = await resolvePermissionSettings({ ensureReady, request }, options);
        const threadId = await ensureThread({ ...options, permissionSettings });
        const input = [];
        if (options.skill?.name && options.skill?.path) {
          input.push({ type: 'skill', name: options.skill.name, path: options.skill.path });
        }
        if (options.prompt) input.push({ type: 'text', text: options.prompt });
        for (const attachment of options.attachments || []) {
          if (attachment.kind === 'image') input.push({ type: 'localImage', path: attachment.path });
          else input.push({ type: 'mention', name: attachment.name, path: attachment.path });
        }
        const params = {
          threadId,
          input,
          model: options.model || null,
          approvalPolicy: permissionSettings.approvalPolicy,
          sandboxPolicy: permissionSettings.sandboxPolicy,
        };
        if (options.reasoningEffort) params.effort = options.reasoningEffort;
        if (options.collaborationMode && (options.collaborationMode.model || options.model)) {
          params.collaborationMode = {
            mode: options.collaborationMode.mode,
            settings: {
              model: options.collaborationMode.model || options.model,
              reasoning_effort: options.collaborationMode.reasoning_effort || options.reasoningEffort || null,
              developer_instructions: null,
            },
          };
        }
        const result = await request('turn/start', params);
        turnsBySession.set(options.sessionId, result.turn.id);
        return true;
      } catch (error) {
        send('cli:error', { sessionId: options.sessionId, error: error.message });
        return false;
      }
    },
    async stop(sessionId) {
      const thread = threadsBySession.get(sessionId);
      const turnId = turnsBySession.get(sessionId);
      if (!thread || !turnId) return false;
      await request('turn/interrupt', { threadId: thread.threadId, turnId });
      return true;
    },
    async compact(sessionId, threadId) {
      await ensureReady();
      const known = threadsBySession.get(sessionId)?.threadId || threadId;
      if (!known || turnsBySession.has(sessionId)) return false;
      sessionsByThread.set(known, sessionId);
      if (!threadsBySession.has(sessionId)) {
        await request('thread/resume', { threadId: known });
        threadsBySession.set(sessionId, { threadId: known, cwd: process.cwd() });
      }
      await request('thread/compact/start', { threadId: known });
      return true;
    },
    async rollback(sessionId, threadId) {
      await ensureReady();
      const known = threadsBySession.get(sessionId)?.threadId || threadId;
      if (!known || turnsBySession.has(sessionId)) return false;
      sessionsByThread.set(known, sessionId);
      if (!threadsBySession.has(sessionId)) {
        await request('thread/resume', { threadId: known });
        threadsBySession.set(sessionId, { threadId: known, cwd: process.cwd() });
      }
      await request('thread/rollback', { threadId: known, numTurns: 1 });
      return true;
    },
    resetSession(sessionId) {
      if (!sessionId) return false;
      const thread = threadsBySession.get(sessionId);
      if (thread && sessionsByThread.get(thread.threadId) === sessionId) {
        sessionsByThread.delete(thread.threadId);
      }
      threadsBySession.delete(sessionId);
      turnsBySession.delete(sessionId);
      completedPlans.delete(sessionId);
      return true;
    },
    async listModels() {
      await ensureReady();
      const models = [];
      let cursor = null;
      do {
        const result = await request('model/list', { cursor, includeHidden: false });
        models.push(...result.data);
        cursor = result.nextCursor;
      } while (cursor);
      return models;
    },
    async listCollaborationModes() {
      await ensureReady();
      return (await request('collaborationMode/list', {})).data;
    },
    async listSkills(cwd, forceReload = false) {
      if (!cwd) return [];
      await ensureReady();
      const result = await request('skills/list', { cwds: [cwd], forceReload });
      const normalizedCwd = cwd.toLowerCase();
      const entry = (result.data || []).find(item => item.cwd?.toLowerCase() === normalizedCwd)
        || result.data?.[0];
      return (entry?.skills || []).filter(skill => skill.enabled === true);
    },
    answerUserInput(itemId, answers) {
      const id = userInputRequests.get(itemId);
      if (id === undefined) return false;
      userInputRequests.delete(itemId);
      write({ id, result: { answers } });
      return true;
    },
    reload() {
      if (turnsBySession.size) return false;
      const previous = child;
      child = undefined;
      ready = undefined;
      sessionsByThread.clear();
      threadsBySession.clear();
      userInputRequests.clear();
      completedPlans.clear();
      for (const waiter of pending.values()) waiter.reject(new Error('Codex app-server 已重新加载。'));
      pending.clear();
      if (previous) {
        previous.removeAllListeners('error');
        previous.removeAllListeners('close');
        previous.kill();
      }
      return true;
    },
    dispose() { child?.kill(); },
  };
}

module.exports = { createCodexAppServer };
