const { removeThreads } = require('./ipc-thread-removal.cjs');
const { enrichSessionWithCodexTranscript, loadCodexSession } = require('./codex-history.cjs');

function registerSessionHandlers({ codexHome, codexProcess, getInstallation, ipcMain, onThemeChanged = () => undefined, store }) {
  const withCachedTokenUsage = session => {
    if (!session?.threadId) return session;
    if (session.tokenUsage) {
      store.saveTokenUsage(session.threadId, session.tokenUsage);
      return session;
    }
    const tokenUsage = store.loadTokenUsageCache()[session.threadId];
    return tokenUsage ? { ...session, tokenUsage } : session;
  };
  const withCachedTokenUsages = sessions => (sessions || []).map(withCachedTokenUsage);
  const withHistoricalTranscript = async session => {
    const cached = withCachedTokenUsage(session);
    if (!cached?.threadId) return cached;
    let transcript;
    try { transcript = await loadCodexSession(codexHome, cached.threadId); } catch { return cached; }
    if (!transcript) return cached;
    const enriched = enrichSessionWithCodexTranscript(cached, transcript);
    if (cached.tokenUsage || !transcript.tokenUsage) return enriched;
    const reportedAt = Number.isFinite(transcript.tokenUsage.reportedAt)
      ? transcript.tokenUsage.reportedAt
      : transcript.updated;
    const tokenUsage = { ...transcript.tokenUsage, ...(Number.isFinite(reportedAt) ? { reportedAt } : {}) };
    store.saveTokenUsage(cached.threadId, tokenUsage);
    return { ...enriched, tokenUsage };
  };
  // Sidebar records need only thread/list metadata. Reading every thread's turns
  // here delays the whole list until the slowest history read has completed.
  const history = async () => withCachedTokenUsages(await codexProcess.listThreads(false));

  ipcMain.handle('sessions:list', () => history());
  ipcMain.handle('sessions:history', () => history());
  ipcMain.handle('sessions:read', async (_, threadId) => {
    // App Server owns the authoritative thread transcript. Reading every local
    // JSONL fragment here used to block the main process on large histories.
    return withHistoricalTranscript(await codexProcess.readThread(threadId));
  });
  ipcMain.handle('sessions:titles-list', () => store.loadSessionTitles());
  ipcMain.handle('sessions:title-save', (_, threadId, title) => store.saveSessionTitle(threadId, title));
  ipcMain.handle('settings:get', () => store.loadSettings());
  ipcMain.handle('settings:save', (_, settings) => {
    const previous = store.loadSettings();
    const next = store.saveSettings(settings);
    if (previous.theme !== next.theme) onThemeChanged(next.theme);
    return next;
  });
  ipcMain.handle('codex:installation', () => getInstallation());
  ipcMain.handle('codex:path-save', (_, codexPath) => {
    const previous = store.loadSettings();
    const next = store.saveSettings({ codexPath: typeof codexPath === 'string' ? codexPath : '' });
    const installation = getInstallation();
    if (installation.status !== 'ready' && next.codexPath) {
      store.saveSettings({ codexPath: previous.codexPath || '' });
      return { ok: false, error: installation.error };
    }
    if (!codexProcess.reload()) {
      store.saveSettings({ codexPath: previous.codexPath || '' });
      return { ok: false, error: 'Codex 正在执行任务，暂时无法更改路径。' };
    }
    return { ok: true, settings: next, installation };
  });
  ipcMain.handle('sessions:archive', async (_, session) => {
    if (!session?.threadId) return { ok: false, error: '该对话尚未创建 Codex 线程，无法归档。' };
    try {
      const currentSessions = await codexProcess.listThreads(false);
      const currentThread = currentSessions.find(item => item?.threadId === session.threadId);
      if (!currentThread) {
        return { ok: false, error: '该对话已不在当前提供商的会话列表中，请刷新会话列表后重试。' };
      }
      return await codexProcess.archive(session.threadId) ? { ok: true } : { ok: false, error: '无法归档该对话。' };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/no roll.?out found for thread id/i.test(message)) {
        return { ok: false, error: '该对话已不在当前提供商的会话列表中，请刷新会话列表后重试。' };
      }
      return { ok: false, error: message };
    }
  });
  ipcMain.handle('sessions:archived-list', async () => withCachedTokenUsages(await codexProcess.listThreads(true)));
  ipcMain.handle('sessions:restore', async (_, target) => {
    if (!target?.threadId) return { ok: false, error: '无效的归档对话。' };
    try {
      if (!await codexProcess.restore(target.threadId)) return { ok: false, error: '无法恢复该对话。' };
      const session = (await history()).find(item => item.threadId === target.threadId)
        || (withCachedTokenUsages(await codexProcess.listThreads(false))).find(item => item.threadId === target.threadId);
      return session ? { ok: true, session } : { ok: false, error: 'Codex 尚未返回已恢复的对话。' };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('sessions:archived-remove', async (_, target) => {
    if (!target?.threadId) return { ok: false, error: '无效的归档对话。' };
    try {
      if (!await codexProcess.remove(target.threadId)) return { ok: false, error: '无法删除该对话。' };
      store.removeTokenUsage(target.threadId);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('sessions:archived-clear', async () => {
    try {
      const archived = await codexProcess.listThreads(true);
      const { allSucceeded, succeededThreadIds } = await removeThreads(codexProcess, archived.map(session => session.threadId));
      store.removeTokenUsage(succeededThreadIds);
      return allSucceeded
        ? { ok: true, succeededThreadIds }
        : { ok: false, error: '部分归档对话未能删除。', succeededThreadIds };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle('projects:delete', async (_, cwd, sessions) => {
    if (typeof cwd !== 'string' || !cwd) return { ok: false, error: '无效的项目。' };
    if (!Array.isArray(sessions) || sessions.some(session => !session?.id || session.cwd !== cwd)) {
      return { ok: false, error: '无效的项目会话。' };
    }
    if (sessions.some(session => !session.threadId)) return { ok: false, error: '项目中存在尚未创建 Codex 线程的对话。' };
    let succeededThreadIds = [];
    try {
      const result = await removeThreads(codexProcess, sessions.map(session => session.threadId));
      const { allSucceeded } = result;
      succeededThreadIds = result.succeededThreadIds;
      store.removeTokenUsage(succeededThreadIds);
      if (!allSucceeded) return { ok: false, error: '部分对话未能删除。', succeededThreadIds };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    const settings = store.loadSettings();
    store.saveSettings({ projectPaths: (settings.projectPaths || []).filter(projectPath => projectPath !== cwd) });
    return { ok: true, succeededThreadIds };
  });
}

module.exports = { registerSessionHandlers };
