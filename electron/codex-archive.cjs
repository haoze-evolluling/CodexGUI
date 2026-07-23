function sessionKey(session) {
  if (!session || typeof session !== 'object') return '';
  if (typeof session.threadId === 'string' && session.threadId) return `thread:${session.threadId}`;
  if (typeof session.id === 'string' && session.id) return `id:${session.id}`;
  return '';
}

function cloneSessionSnapshot(session) {
  if (!session || typeof session !== 'object' || typeof session.id !== 'string' || !session.id) return null;
  return {
    id: session.id,
    title: typeof session.title === 'string' && session.title ? session.title : '未命名对话',
    cwd: typeof session.cwd === 'string' ? session.cwd : '',
    updated: Number.isFinite(session.updated) ? session.updated : Date.now(),
    ...(typeof session.threadId === 'string' && session.threadId ? { threadId: session.threadId } : {}),
    ...(typeof session.model === 'string' && session.model ? { model: session.model } : {}),
    ...(typeof session.reasoningEffort === 'string' && session.reasoningEffort ? { reasoningEffort: session.reasoningEffort } : {}),
    ...(session.collaborationMode === 'plan' || session.collaborationMode === 'default'
      ? { collaborationMode: session.collaborationMode }
      : {}),
    ...(Array.isArray(session.timeline) ? { timeline: session.timeline } : {}),
    ...(Array.isArray(session.messages) ? { messages: session.messages } : {}),
    ...(session.tokenUsage ? { tokenUsage: session.tokenUsage } : {}),
    archivedAt: Date.now(),
  };
}

function normalizeArchivedSessions(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const items = [];
  for (const item of value) {
    const snapshot = cloneSessionSnapshot(item);
    if (!snapshot) continue;
    const key = sessionKey(snapshot);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({
      ...snapshot,
      archivedAt: Number.isFinite(item?.archivedAt) ? item.archivedAt : snapshot.archivedAt,
    });
  }
  return items.sort((left, right) => (right.archivedAt || right.updated || 0) - (left.archivedAt || left.updated || 0));
}

function threadIdsFromArchivedSessions(sessions) {
  return new Set(
    normalizeArchivedSessions(sessions)
      .map(session => session.threadId)
      .filter(threadId => typeof threadId === 'string' && threadId),
  );
}

function removeArchivedSessions(sessions, session) {
  return (Array.isArray(sessions) ? sessions : []).filter(item =>
    item.id !== session.id &&
    (!session.threadId || item.threadId !== session.threadId),
  );
}

function upsertArchivedSession(sessions, session) {
  const snapshot = cloneSessionSnapshot(session);
  if (!snapshot) return normalizeArchivedSessions(sessions);
  const key = sessionKey(snapshot);
  const next = normalizeArchivedSessions(sessions).filter(item => sessionKey(item) !== key);
  next.unshift(snapshot);
  return next;
}

function findArchivedSession(sessions, target) {
  const key = sessionKey(target);
  if (!key) return null;
  return normalizeArchivedSessions(sessions).find(item => sessionKey(item) === key) || null;
}

function removeArchivedSessionEntry(sessions, target) {
  const key = sessionKey(target);
  if (!key) return normalizeArchivedSessions(sessions);
  return normalizeArchivedSessions(sessions).filter(item => sessionKey(item) !== key);
}

function buildArchiveArgs(threadId) {
  return ['archive', threadId];
}

module.exports = {
  buildArchiveArgs,
  cloneSessionSnapshot,
  findArchivedSession,
  normalizeArchivedSessions,
  removeArchivedSessionEntry,
  removeArchivedSessions,
  sessionKey,
  threadIdsFromArchivedSessions,
  upsertArchivedSession,
};
