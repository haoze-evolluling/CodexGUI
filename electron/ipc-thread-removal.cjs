async function removeThreads(codexProcess, threadIds) {
  const results = await Promise.all(threadIds.map(async threadId => ({
    threadId,
    ok: await codexProcess.remove(threadId).catch(() => false),
  })));
  return {
    allSucceeded: results.every(result => result.ok),
    succeededThreadIds: results.filter(result => result.ok).map(result => result.threadId),
  };
}

module.exports = { removeThreads };
