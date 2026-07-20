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

module.exports = { buildCodexArgs, buildSpawnOptions, createDiagnostics, createEventParser, eventToMessage };
