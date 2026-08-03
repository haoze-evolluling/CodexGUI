const readline = require('readline');
const { activityFromItem, resolvePermissionSettings } = require('./codex-app-server-support.cjs');
const { inputFromOptions } = require('./codex-app-server-input.cjs');
const { createThreadSessionMapper } = require('./codex-app-server-sessions.cjs');
const { normalizeTokenUsage, tokenUsageFromThread } = require('./codex-token-usage.cjs');

function createCodexAppServer({ attachDiffs, getSpawnConfig, saveTokenUsage, send, spawn }) {
  let child;
  let ready;
  let nextId = 1;
  const pending = new Map();
  const sessionsByThread = new Map();
  const threadsBySession = new Map();
  const turnsBySession = new Map();
  const completedTurnIds = new Map();
  const startingSessions = new Set();
  const userInputRequests = new Map();
  const completedPlans = new Map();
  const planTurnsBySession = new Set();
  const lastUsedSessions = new Map();
  const MAX_IDLE_SESSION_MAPPINGS = 200;
  const pendingDeltas = new Map();
  let deltaTimer;
  let outputReader;
  const { sessionFromThread } = createThreadSessionMapper({ activityFromItem, attachDiffs });

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
    const sessionId = sessionsByThread.get(threadId);
    if (sessionId) lastUsedSessions.set(sessionId, Date.now());
    return sessionId;
  }

  function pruneIdleSessionMappings() {
    if (threadsBySession.size <= MAX_IDLE_SESSION_MAPPINGS) return;
    const candidates = [...threadsBySession.entries()]
      .filter(([sessionId]) => !turnsBySession.has(sessionId) && !startingSessions.has(sessionId))
      .sort(([left], [right]) => (lastUsedSessions.get(left) || 0) - (lastUsedSessions.get(right) || 0));
    while (threadsBySession.size > MAX_IDLE_SESSION_MAPPINGS && candidates.length) {
      const [sessionId, thread] = candidates.shift();
      threadsBySession.delete(sessionId);
      sessionsByThread.delete(thread.threadId);
      completedTurnIds.delete(sessionId);
      completedPlans.delete(sessionId);
      planTurnsBySession.delete(sessionId);
      lastUsedSessions.delete(sessionId);
    }
  }

  function emitForThread(channel, threadId, value = {}) {
    const sessionId = sessionIdFor(threadId);
    if (sessionId) send(channel, { sessionId, ...value });
  }

  function publishTokenUsage(threadId, tokenUsage) {
    if (!tokenUsage) return null;
    try { saveTokenUsage?.(threadId, tokenUsage); } catch { /* Cache failures must not affect Codex. */ }
    emitForThread('cli:token-usage', threadId, { tokenUsage });
    return tokenUsage;
  }

  function emitTokenUsage(threadId, value) {
    return publishTokenUsage(threadId, normalizeTokenUsage(value));
  }

  function markTokenUsagePending(threadId) {
    emitForThread('cli:token-usage-pending', threadId);
  }

  function refreshTokenUsage(threadId) {
    if (!threadId || !sessionIdFor(threadId)) return;
    markTokenUsagePending(threadId);
    void request('thread/read', { threadId, includeTurns: false }).then(result => {
      const tokenUsage = tokenUsageFromThread(result?.thread);
      publishTokenUsage(threadId, tokenUsage);
    }).catch(() => undefined);
  }

  function flushDeltas(sessionId) {
    for (const [key, value] of pendingDeltas) {
      if (sessionId && value.sessionId !== sessionId) continue;
      pendingDeltas.delete(key);
      send('cli:data', value);
    }
    if (!pendingDeltas.size && deltaTimer) {
      clearTimeout(deltaTimer);
      deltaTimer = undefined;
    }
  }

  function queueDelta(threadId, params) {
    const sessionId = sessionIdFor(threadId);
    if (!sessionId) return;
    const key = `${sessionId}\u0000${params.itemId}`;
    const current = pendingDeltas.get(key);
    pendingDeltas.set(key, {
      sessionId,
      itemId: params.itemId,
      text: `${current?.text || ''}${params.delta || ''}`,
    });
    if (!deltaTimer) deltaTimer = setTimeout(() => {
      deltaTimer = undefined;
      flushDeltas();
    }, 50);
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
      queueDelta(threadId, params);
      return;
    }
    if (message.method === 'item/started' || message.method === 'item/completed' || message.method === 'item/called') {
      const status = message.method === 'item/started' || message.method === 'item/called' ? 'running' : 'completed';
      if (status === 'completed' && (params.item?.type === 'agentMessage' || params.item?.type === 'plan') && typeof params.item.text === 'string') {
        flushDeltas(sessionIdFor(threadId));
        emitForThread('cli:data', threadId, { itemId: params.item.id, text: params.item.text, full: true });
      }
      // Some app-server releases complete the final plan as an agentMessage
      // instead of a plan item. The turn's requested collaboration mode is the
      // authoritative context for interpreting that final response.
      const isCompletedPlan = status === 'completed'
        && typeof params.item?.text === 'string'
        && (params.item.type === 'plan'
          || (params.item.type === 'agentMessage' && planTurnsBySession.has(sessionIdFor(threadId))));
      if (isCompletedPlan) {
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
          refreshTokenUsage(threadId);
        }
      }
      return;
    }
    if (message.method === 'turn/started') {
      const sessionId = sessionIdFor(threadId);
      if (sessionId) {
        turnsBySession.set(sessionId, params.turn?.id);
        completedTurnIds.delete(sessionId);
        completedPlans.delete(sessionId);
      }
      return;
    }
    if (message.method === 'turn/completed') {
      const sessionId = sessionIdFor(threadId);
      if (!sessionId) return;
      const activeTurnId = turnsBySession.get(sessionId);
      // A delayed completion from an interrupted turn must not end a turn that
      // was subsequently started for the same session. A completion without a
      // turn id cannot be safely associated with the active turn.
      if (!activeTurnId || !params.turn?.id || params.turn.id !== activeTurnId) return;
      flushDeltas(sessionId);
      completedTurnIds.set(sessionId, activeTurnId);
      turnsBySession.delete(sessionId);
      const error = params.turn?.error?.message;
      if (error) send('cli:error', { sessionId, error });
      const plan = completedPlans.get(sessionId);
      completedPlans.delete(sessionId);
      planTurnsBySession.delete(sessionId);
      for (const [itemId, request] of userInputRequests) {
        if (request.sessionId === sessionId) userInputRequests.delete(itemId);
      }
      // The renderer must receive the plan action before it handles completion.
      // A generic history refresh does not include turn items and would otherwise
      // replace the streamed plan and tool activity with a metadata-only record.
      refreshTokenUsage(threadId);
      if (!error && plan) send('cli:plan-ready', { sessionId, plan });
      send('cli:exit', { sessionId, status: params.turn?.status, hasPlan: Boolean(!error && plan), hadError: Boolean(error) });
      pruneIdleSessionMappings();
      return;
    }
    if (message.method === 'thread/compacted') {
      emitForThread('cli:compacted', threadId);
      refreshTokenUsage(threadId);
      return;
    }
    if (message.method === 'thread/status/changed') {
      emitForThread('cli:status', threadId, { status: params.status });
      return;
    }
    if (message.method === 'thread/tokenUsage/updated') {
      emitTokenUsage(threadId, params.tokenUsage);
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
    userInputRequests.set(message.params.itemId, { id: message.id, sessionId });
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
    outputReader = readline.createInterface({ input: child.stdout });
    outputReader.on('line', handleLine);
    child.stderr.on('data', data => send('cli:server-error', { error: data.toString() }));
    child.on('error', failAll);
    child.on('close', code => failAll(new Error(`Codex app-server exited with code ${code}.`)));
    ready = request('initialize', {
      clientInfo: { name: 'codex_gui', title: 'Codex GUI', version: '1.2.1' },
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
    sessionsByThread.clear();
    threadsBySession.clear();
    completedTurnIds.clear();
    lastUsedSessions.clear();
    completedPlans.clear();
    planTurnsBySession.clear();
    userInputRequests.clear();
    flushDeltas();
    outputReader?.close();
    outputReader = undefined;
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
    let resumed = false;
    if (!threadId && options.threadId) {
      threadId = options.threadId;
      await request('thread/resume', { threadId });
      resumed = true;
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
    lastUsedSessions.set(options.sessionId, Date.now());
    send('cli:thread', { sessionId: options.sessionId, threadId });
    if (resumed) refreshTokenUsage(threadId);
    return threadId;
  }

  return {
    async start(options) {
      if (!options.sessionId || turnsBySession.has(options.sessionId) || startingSessions.has(options.sessionId)) return false;
      startingSessions.add(options.sessionId);
      completedTurnIds.delete(options.sessionId);
      // Notifications may arrive before the turn/start response. Register the
      // requested mode before sending the request so an agentMessage plan is
      // not misclassified during that window.
      if (options.collaborationMode?.mode === 'plan') planTurnsBySession.add(options.sessionId);
      else planTurnsBySession.delete(options.sessionId);
      try {
        const input = inputFromOptions(options);
        if (!input.length) throw new Error('请输入消息或添加有效附件。');
        const permissionSettings = await resolvePermissionSettings({ ensureReady, request }, options);
        const threadId = await ensureThread({ ...options, permissionSettings });
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
              reasoning_effort: options.reasoningEffort || options.collaborationMode.reasoning_effort || null,
              developer_instructions: null,
            },
          };
        }
        const result = await request('turn/start', params);
        // Notifications can complete a very short turn before turn/start's
        // response is processed. Do not resurrect that completed turn locally.
        if (completedTurnIds.get(options.sessionId) !== result.turn.id) {
          turnsBySession.set(options.sessionId, result.turn.id);
        }
        return true;
      } catch (error) {
        planTurnsBySession.delete(options.sessionId);
        send('cli:error', { sessionId: options.sessionId, error: error instanceof Error ? error.message : String(error) });
        return false;
      } finally {
        startingSessions.delete(options.sessionId);
      }
    },
    async stop(sessionId) {
      lastUsedSessions.set(sessionId, Date.now());
      const thread = threadsBySession.get(sessionId);
      const turnId = turnsBySession.get(sessionId);
      if (!thread || !turnId) return false;
      try {
        await request('turn/interrupt', { threadId: thread.threadId, turnId });
      } catch (error) {
        // Codex can complete a turn between reading turnId and interrupting it.
        // Do not synthesize completion here: only turn/completed can establish
        // that the turn tracked by this session has actually ended.
        if (!/no active turn to interrupt/i.test(error instanceof Error ? error.message : String(error))) throw error;
      }
      return true;
    },
    async compact(sessionId, threadId) {
      lastUsedSessions.set(sessionId, Date.now());
      await ensureReady();
      const known = threadsBySession.get(sessionId)?.threadId || threadId;
      if (!known || turnsBySession.has(sessionId)) return false;
      sessionsByThread.set(known, sessionId);
      if (!threadsBySession.has(sessionId)) {
        await request('thread/resume', { threadId: known });
        threadsBySession.set(sessionId, { threadId: known, cwd: process.cwd() });
      }
      await request('thread/compact/start', { threadId: known });
      markTokenUsagePending(known);
      return true;
    },
    async rollback(sessionId, threadId) {
      lastUsedSessions.set(sessionId, Date.now());
      await ensureReady();
      const known = threadsBySession.get(sessionId)?.threadId || threadId;
      if (!known || turnsBySession.has(sessionId)) return false;
      sessionsByThread.set(known, sessionId);
      if (!threadsBySession.has(sessionId)) {
        await request('thread/resume', { threadId: known });
        threadsBySession.set(sessionId, { threadId: known, cwd: process.cwd() });
      }
      await request('thread/rollback', { threadId: known, numTurns: 1 });
      markTokenUsagePending(known);
      // Use the authoritative post-rollback snapshot. The rollback response can
      // contain stale or incomplete turns depending on the app-server version.
      const result = await request('thread/read', { threadId: known, includeTurns: true });
      const tokenUsage = tokenUsageFromThread(result?.thread);
      publishTokenUsage(known, tokenUsage);
      return await sessionFromThread(result.thread);
    },
    async archive(threadId) {
      await ensureReady();
      if (!threadId) return false;
      await request('thread/archive', { threadId });
      return true;
    },
    async restore(threadId) {
      await ensureReady();
      if (!threadId) return false;
      await request('thread/unarchive', { threadId });
      return true;
    },
    async remove(threadId) {
      await ensureReady();
      if (!threadId) return false;
      await request('thread/delete', { threadId });
      return true;
    },
    async listThreads(archived, includeTurns = false) {
      await ensureReady();
      const threads = [];
      let cursor = null;
      do {
        const result = await request('thread/list', { archived, cursor, limit: 100 });
        threads.push(...(result.data || []));
        cursor = result.nextCursor;
      } while (cursor);
      const sessions = threads.filter(thread => thread?.id);
      if (!includeTurns) return Promise.all(sessions.map(sessionFromThread));
      return Promise.all(sessions.map(async thread => {
        const result = await request('thread/read', { threadId: thread.id, includeTurns: true });
        return sessionFromThread(result.thread);
      }));
    },
    async readThread(threadId) {
      await ensureReady();
      if (!threadId) return null;
      const result = await request('thread/read', { threadId, includeTurns: true });
      return sessionFromThread(result.thread);
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
      const request = userInputRequests.get(itemId);
      if (!request) return false;
      userInputRequests.delete(itemId);
      write({ id: request.id, result: { answers } });
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
      completedTurnIds.clear();
      for (const waiter of pending.values()) waiter.reject(new Error('Codex app-server 已重新加载。'));
      pending.clear();
      if (previous) {
        previous.removeAllListeners('error');
        previous.removeAllListeners('close');
        previous.kill();
      }
      outputReader?.close();
      outputReader = undefined;
      flushDeltas();
      return true;
    },
    async restart() {
      if (!this.reload()) return false;
      await ensureReady();
      return true;
    },
    isBusy() {
      return turnsBySession.size > 0 || startingSessions.size > 0;
    },
    dispose() {
      outputReader?.close();
      outputReader = undefined;
      flushDeltas();
      child?.kill();
    },
  };
}

module.exports = { createCodexAppServer };
