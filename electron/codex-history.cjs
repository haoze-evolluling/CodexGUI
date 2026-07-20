const fs = require('fs');
const path = require('path');

function textFromContent(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter(part => part && typeof part.text === 'string' && (part.type === 'input_text' || part.type === 'output_text' || part.type === 'text'))
    .map(part => part.text)
    .join('\n');
}

function messageFromRecord(record) {
  const payload = record?.payload;
  if (!payload) return null;

  if (record.type === 'event_msg' && payload.type === 'user_message' && typeof payload.message === 'string') {
    return { role: 'user', text: payload.message };
  }

  if (record.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
    const text = textFromContent(payload.content);
    return text ? { role: payload.role, text } : null;
  }

  if (record.type === 'response_item' && payload.type === 'agent_message' && typeof payload.text === 'string') {
    return { role: 'assistant', text: payload.text };
  }

  return null;
}

function parseSessionFile(filePath) {
  let lines;
  try { lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/); } catch { return null; }

  let meta;
  const messages = [];
  let updated = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const timestamp = Date.parse(record.timestamp);
      if (Number.isFinite(timestamp)) updated = Math.max(updated, timestamp);
      if (record.type === 'session_meta') meta = record.payload;
      const message = messageFromRecord(record);
      if (message) messages.push(message);
    } catch {
      // Codex can leave a partial final JSONL line when a session is interrupted.
    }
  }

  const threadId = meta?.session_id || meta?.id;
  if (!threadId) return null;
  const firstUserMessage = messages.find(message => message.role === 'user')?.text || '未命名对话';
  return {
    id: `codex-${threadId}`,
    threadId,
    cwd: typeof meta.cwd === 'string' ? meta.cwd : '',
    title: firstUserMessage.slice(0, 64),
    messages,
    updated: updated || Date.now(),
  };
}

function sessionFiles(root) {
  const files = [];
  const visit = directory => {
    let entries;
    try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(filePath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(filePath);
    }
  };
  visit(root);
  return files;
}

function loadCodexHistory(codexHome) {
  const sessionsRoot = path.join(codexHome, 'sessions');
  return sessionFiles(sessionsRoot)
    .map(parseSessionFile)
    .filter(Boolean)
    .sort((left, right) => right.updated - left.updated);
}

function mergeSessions(saved, imported) {
  const seenThreads = new Set(saved.map(session => session.threadId).filter(Boolean));
  const seenIds = new Set(saved.map(session => session.id));
  const additions = imported.filter(session => !seenThreads.has(session.threadId) && !seenIds.has(session.id));
  return [...saved, ...additions].sort((left, right) => right.updated - left.updated);
}

module.exports = { loadCodexHistory, mergeSessions, parseSessionFile };
