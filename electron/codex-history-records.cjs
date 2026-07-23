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
    return { id: payload.id || `command-${payload.call_id || Math.random()}`, type: 'command', status: payload.status || 'completed', command: Array.isArray(payload.command) ? payload.command.join(' ') : payload.command || '', output: payload.aggregated_output || '', exitCode: payload.exit_code };
  }
  if (record.type === 'response_item' && payload.type === 'file_change' && Array.isArray(payload.changes)) {
    return { id: payload.id || `file-change-${Math.random()}`, type: 'file_change', status: payload.status || 'completed', files: payload.changes.filter(change => change && typeof change.path === 'string').map(change => ({ path: change.path, kind: change.kind || 'update' })) };
  }
  if (record.type === 'response_item' && payload.type === 'custom_tool_call') {
    const files = patchFiles(payload.input);
    return { id: payload.call_id || payload.id || `tool-${Math.random()}`, type: 'command', status: payload.status || 'completed', command: payload.input || payload.name || '工具调用', output: '', files };
  }
  return null;
}

function tokenUsageFromRecord(record) {
  const payload = record?.payload;
  const info = payload?.info;
  if (record?.type !== 'event_msg' || payload?.type !== 'token_count' || !info) return null;
  const normalize = value => value && typeof value === 'object' ? {
    cachedInputTokens: Number(value.cached_input_tokens) || 0,
    inputTokens: Number(value.input_tokens) || 0,
    outputTokens: Number(value.output_tokens) || 0,
    reasoningOutputTokens: Number(value.reasoning_output_tokens) || 0,
    totalTokens: Number(value.total_tokens) || 0,
  } : null;
  const last = normalize(info.last_token_usage);
  const total = normalize(info.total_token_usage);
  return last && total ? { last, total, modelContextWindow: Number.isFinite(info.model_context_window) ? info.model_context_window : null } : null;
}

module.exports = { activityFromRecord, messageFromRecord, tokenUsageFromRecord };
