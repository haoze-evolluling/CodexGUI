function buildCodexArgs(prompt, threadId) {
  const prefix = threadId
    ? ['exec', 'resume', '--json', threadId]
    : ['exec', '--json'];

  return [...prefix, prompt];
}

function buildSpawnOptions(cwd) {
  return {
    cwd,
    shell: false,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  };
}

function createEventParser(onEvent, onMalformedLine) {
  let buffer = '';

  function parseLine(line) {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line));
    } catch {
      onMalformedLine?.(line);
    }
  }

  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(parseLine);
    },
    end() {
      parseLine(buffer);
      buffer = '';
    },
  };
}

function eventToMessage(event) {
  if (event.type === 'thread.started') {
    return { threadId: event.thread_id };
  }
  if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
    return { text: event.item.text };
  }
  return {};
}

function eventToActivity(event) {
  if (!['item.started', 'item.updated', 'item.completed'].includes(event.type)) return {};
  const item = event.item;
  if (!item || !item.id) return {};
  const status = event.type === 'item.started' ? 'running' : event.type === 'item.completed' ? 'completed' : item.status || 'running';

  if (item.type === 'command_execution') {
    const command = Array.isArray(item.command) ? item.command.join(' ') : item.command;
    return {
      activity: {
        id: item.id,
        type: 'command',
        status,
        command: typeof command === 'string' ? command : '',
        output: typeof item.aggregated_output === 'string' ? item.aggregated_output : '',
        exitCode: typeof item.exit_code === 'number' ? item.exit_code : undefined,
      },
    };
  }

  if (item.type === 'file_change' && Array.isArray(item.changes)) {
    return {
      activity: {
        id: item.id,
        type: 'file_change',
        status,
        files: item.changes
          .filter(change => change && typeof change.path === 'string')
          .map(change => ({ path: change.path, kind: typeof change.kind === 'string' ? change.kind : 'update' })),
      },
    };
  }

  return {};
}

function createDiagnostics() {
  const chunks = [];

  return {
    add(value) {
      const text = String(value).trim();
      if (text) chunks.push(text);
    },
    errorForExit(code) {
      if (code === 0) return null;
      return chunks.join('\n') || `Codex exited with code ${code}.`;
    },
  };
}

module.exports = { buildCodexArgs, buildSpawnOptions, createDiagnostics, createEventParser, eventToMessage, eventToActivity };
