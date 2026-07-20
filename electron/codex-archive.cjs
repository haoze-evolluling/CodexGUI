function buildArchiveArgs(threadId) {
  return ['archive', threadId];
}

function removeArchivedSessions(sessions, session) {
  return sessions.filter(item =>
    item.id !== session.id &&
    (!session.threadId || item.threadId !== session.threadId),
  );
}

module.exports = { buildArchiveArgs, removeArchivedSessions };
