const readline = require('readline');

function parseTime(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function sessionFromThread(thread) {
  const threadId = thread?.id;
  return {
    id: `codex-${threadId}`,
    threadId,
    title: thread?.name || thread?.title || thread?.preview || '未命名对话',
    cwd: thread?.cwd || '',
    updated: parseTime(thread?.updatedAt ?? thread?.updated_at),
    ...(thread?.model ? { model: thread.model } : {}),
    ...(thread?.archivedAt || thread?.archived_at ? { archivedAt: parseTime(thread.archivedAt || thread.archived_at) } : {}),
  };
}

function createCodexAppServer({ getSpawnConfig, spawn }) {
  let child;
  let ready;
  let nextId = 1;
  let outputReader;
  const pending = new Map();

  function write(message) {
    if (!child?.stdin?.writable) throw new Error('Codex app-server is not running.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method, params = {}) {
    const id = nextId++;
    write({ method, id, params });
    return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  }

  function failAll(error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    for (const waiter of pending.values()) waiter.reject(failure);
    pending.clear();
    outputReader?.close();
    outputReader = undefined;
    child = undefined;
    ready = undefined;
  }

  function handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id === undefined) return;
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(message.error.message || 'Codex request failed.'));
    else waiter.resolve(message.result);
  }

  function startProcess() {
    const config = getSpawnConfig();
    child = spawn(config.command, config.args, config.options);
    outputReader = readline.createInterface({ input: child.stdout });
    outputReader.on('line', handleLine);
    child.on('error', failAll);
    child.on('close', code => failAll(new Error(`Codex app-server exited with code ${code}.`)));
    ready = request('initialize', {
      clientInfo: { name: 'codex_gui', title: 'Codex GUI', version: '1.2.1' },
      capabilities: { experimentalApi: true },
    }).then(result => { write({ method: 'initialized', params: {} }); return result; });
    return ready;
  }

  function ensureReady() {
    return ready || startProcess();
  }

  return {
    async listThreads(archived) {
      await ensureReady();
      const threads = [];
      let cursor = null;
      do {
        const result = await request('thread/list', { archived, cursor, limit: 100 });
        threads.push(...(result?.data || []));
        cursor = result?.nextCursor || null;
      } while (cursor);
      return threads.filter(thread => thread?.id).map(sessionFromThread);
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
    reload() {
      if (!child) return true;
      const previous = child;
      child = undefined;
      ready = undefined;
      outputReader?.close();
      outputReader = undefined;
      for (const waiter of pending.values()) waiter.reject(new Error('Codex app-server 已重新加载。'));
      pending.clear();
      previous.removeAllListeners();
      previous.kill();
      return true;
    },
    async restart() {
      if (!this.reload()) return false;
      await ensureReady();
      return true;
    },
    isBusy() { return false; },
    dispose() { this.reload(); },
  };
}

module.exports = { createCodexAppServer };
