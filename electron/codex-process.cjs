const {
  buildCodexArgs,
  buildSpawnOptions,
  createDiagnostics,
  createEventParser,
  eventToActivity,
  eventToMessage,
} = require('./codex-runner.cjs');

function createCodexProcess({ attachDiffs, requests, send, spawn }) {
  function emitActivity(sessionId, cwd, activity) {
    send('cli:activity', { sessionId, activity });
    if (activity.type === 'file_change' && activity.status === 'completed') {
      attachDiffs(cwd, activity.files).then(files => {
        send('cli:activity', { sessionId, activity: { ...activity, files } });
      });
    }
  }

  return {
    start(options) {
      if (!options.sessionId || requests.isRunning(options.sessionId)) return false;
      const cwd = options.cwd || process.cwd();
      const diagnostics = createDiagnostics();
      const parser = createEventParser(event => {
        const message = eventToMessage(event);
        const activity = eventToActivity(event);
        if (message.threadId) send('cli:thread', { sessionId: options.sessionId, threadId: message.threadId });
        if (message.text) send('cli:data', { sessionId: options.sessionId, stream: 'stdout', text: message.text });
        if (activity.activity) emitActivity(options.sessionId, cwd, activity.activity);
      }, line => diagnostics.add(line));
      const child = spawn(
        options.command || 'codex',
        buildCodexArgs(options.prompt, options.threadId),
        buildSpawnOptions(cwd),
      );
      requests.start(options.sessionId, child);
      child.stdout.on('data', data => parser.push(data.toString()));
      child.stderr.on('data', data => diagnostics.add(data.toString()));
      child.on('close', code => {
        parser.end();
        const error = diagnostics.errorForExit(code);
        if (error) send('cli:error', { sessionId: options.sessionId, error });
        send('cli:exit', { sessionId: options.sessionId, code });
        requests.finish(options.sessionId, child);
      });
      child.on('error', error => {
        send('cli:error', { sessionId: options.sessionId, error: error.message });
        requests.finish(options.sessionId, child);
      });
      return true;
    },
    stop(sessionId) {
      return requests.stop(sessionId);
    },
  };
}

module.exports = { createCodexProcess };
