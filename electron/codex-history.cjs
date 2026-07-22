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

function patchFiles(input) {
  const match = typeof input === 'string' && input.match(/const patch = ("(?:\\.|[^"\\])*");/s);
  if (!match) return [];
  let patch;
  try { patch = JSON.parse(match[1]); } catch { return []; }
  const files = [];
  for (const line of patch.split(/\r?\n/)) {
    const file = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (file) files.push({ path: file[2], kind: file[1].toLowerCase(), diff: patch });
  }
  return files;
}

function activityFromRecord(record) {
  const payload = record?.payload;
  if (!payload) return null;

  if (record.type === 'response_item' && payload.type === 'command_execution') {
    return {
      id: payload.id || `command-${payload.call_id || Math.random()}`,
      type: 'command', status: payload.status || 'completed',
      command: Array.isArray(payload.command) ? payload.command.join(' ') : payload.command || '',
      output: payload.aggregated_output || '', exitCode: payload.exit_code,
    };
  }

  if (record.type === 'response_item' && payload.type === 'file_change' && Array.isArray(payload.changes)) {
    return {
      id: payload.id || `file-change-${Math.random()}`,
      type: 'file_change', status: payload.status || 'completed',
      files: payload.changes.filter(change => change && typeof change.path === 'string').map(change => ({ path: change.path, kind: change.kind || 'update' })),
    };
  }

  if (record.type === 'response_item' && payload.type === 'custom_tool_call') {
    const files = patchFiles(payload.input);
    return {
      id: payload.call_id || payload.id || `tool-${Math.random()}`,
      type: 'command', status: payload.status || 'completed', command: payload.input || payload.name || '工具调用', output: '',
      files,
    };
  }

  return null;
}

function tokenUsageBreakdown(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    cachedInputTokens: Number(value.cached_input_tokens) || 0,
    inputTokens: Number(value.input_tokens) || 0,
    outputTokens: Number(value.output_tokens) || 0,
    reasoningOutputTokens: Number(value.reasoning_output_tokens) || 0,
    totalTokens: Number(value.total_tokens) || 0,
  };
}

function tokenUsageFromRecord(record) {
  const payload = record?.payload;
  const info = payload?.info;
  if (record?.type !== 'event_msg' || payload?.type !== 'token_count' || !info) return null;
  const last = tokenUsageBreakdown(info.last_token_usage);
  const total = tokenUsageBreakdown(info.total_token_usage);
  if (!last || !total) return null;
  return {
    last,
    total,
    modelContextWindow: Number.isFinite(info.model_context_window) ? info.model_context_window : null,
  };
}

function parseSessionFile(filePath) {
  let lines;
  try { lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/); } catch { return null; }

  let meta;
  const messages = [];
  const timeline = [];
  const commands = new Map();
  let tokenUsage;
  let updated = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const payload = record?.payload;
      const timestamp = Date.parse(record.timestamp);
      if (Number.isFinite(timestamp)) updated = Math.max(updated, timestamp);
      if (record.type === 'session_meta') meta = record.payload;
      tokenUsage = tokenUsageFromRecord(record) || tokenUsage;
      const message = messageFromRecord(record);
      if (message) {
        messages.push(message);
        timeline.push({ id: `message-${timeline.length}`, type: 'message', ...message });
      }
      const activity = activityFromRecord(record);
      if (activity) {
        timeline.push(activity);
        if (activity.type === 'command') {
          commands.set(activity.id, activity);
          if (activity.files?.length) timeline.push({ id: `file-change-${activity.id}`, type: 'file_change', status: activity.status, files: activity.files });
        }
      }
      if (record.type === 'response_item' && payload?.type === 'custom_tool_call_output') {
        const command = commands.get(payload.call_id);
        if (command) command.output = Array.isArray(payload.output) ? payload.output.map(part => part.text || '').join('\n') : String(payload.output || '');
      }
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
    timeline,
    ...(tokenUsage ? { tokenUsage } : {}),
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

function mergeGuiSystemMessages(savedTimeline, importedTimeline) {
  const systemsByPosition = new Map();
  const importedSystemKeys = new Set(importedTimeline
    .filter(item => item?.type === 'message' && item.role === 'system')
    .map(item => `${item.text || ''}\n${JSON.stringify(item.attachments || [])}`));
  let nonSystemPosition = 0;
  for (const item of savedTimeline) {
    if (item?.type === 'message' && item.role === 'system') {
      const key = `${item.text || ''}\n${JSON.stringify(item.attachments || [])}`;
      if (importedSystemKeys.has(key)) continue;
      const messages = systemsByPosition.get(nonSystemPosition) || [];
      messages.push(item);
      systemsByPosition.set(nonSystemPosition, messages);
    } else {
      nonSystemPosition += 1;
    }
  }

  const merged = [];
  nonSystemPosition = 0;
  for (const item of importedTimeline) {
    merged.push(...(systemsByPosition.get(nonSystemPosition) || []), item);
    systemsByPosition.delete(nonSystemPosition);
    if (!(item?.type === 'message' && item.role === 'system')) nonSystemPosition += 1;
  }
  for (const messages of systemsByPosition.values()) merged.push(...messages);
  return merged;
}

function mergeSessions(saved, imported) {
  const importedByThread = new Map(imported.filter(session => session.threadId).map(session => [session.threadId, session]));
  const mergedSaved = saved.map(session => {
    const importedSession = importedByThread.get(session.threadId);
    if (!importedSession) return session;
    const savedTimeline = Array.isArray(session.timeline) ? session.timeline : session.messages || [];
    const hasImportedTimeline = Array.isArray(importedSession.timeline) || Array.isArray(importedSession.messages);
    const importedTimeline = Array.isArray(importedSession.timeline) ? importedSession.timeline : importedSession.messages || [];
    if (!hasImportedTimeline && !importedSession.tokenUsage) return session;
    return {
      ...session,
      ...(hasImportedTimeline ? {
        messages: importedSession.messages,
        timeline: mergeGuiSystemMessages(savedTimeline, importedTimeline),
      } : {}),
      ...(importedSession.tokenUsage ? { tokenUsage: importedSession.tokenUsage } : {}),
      updated: Math.max(session.updated || 0, importedSession.updated || 0),
    };
  });
  const seenThreads = new Set(mergedSaved.map(session => session.threadId).filter(Boolean));
  const seenIds = new Set(mergedSaved.map(session => session.id));
  const additions = imported.filter(session => !seenThreads.has(session.threadId) && !seenIds.has(session.id));
  return [...mergedSaved, ...additions].sort((left, right) => right.updated - left.updated);
}

module.exports = { loadCodexHistory, mergeSessions, parseSessionFile };
