const { activityFromRecord, messageFromRecord, tokenUsageFromRecord } = require('./codex-history-records.cjs');
const { textFromToolOutput } = require('./codex-app-server-support.cjs');

function parseSessionLines(lines) {
  let meta;
  const messages = [];
  const timeline = [];
  const commands = new Map();
  let tokenUsage;
  let updated = 0;
  const removeLastTurns = count => {
    for (let index = 0; index < count; index += 1) {
      const timelineIndex = timeline.map(item => item?.type === 'message' && item.role === 'user').lastIndexOf(true);
      if (timelineIndex < 0) break;
      timeline.splice(timelineIndex);
      const messageIndex = messages.map(message => message?.role === 'user').lastIndexOf(true);
      if (messageIndex >= 0) messages.splice(messageIndex);
    }
  };
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      const payload = record?.payload;
      const timestamp = Date.parse(record.timestamp);
      if (Number.isFinite(timestamp)) updated = Math.max(updated, timestamp);
      if (record.type === 'session_meta') meta = record.payload;
      if (record.type === 'event_msg' && payload?.type === 'thread_rolled_back') {
        removeLastTurns(Math.max(1, Number(payload.num_turns) || 1));
      }
      tokenUsage = tokenUsageFromRecord(record) || tokenUsage;
      const message = messageFromRecord(record);
      if (message) {
        const { plan, itemId, ...plainMessage } = message;
        messages.push(plainMessage);
        const id = itemId || `message-${timeline.length}`;
        timeline.push({ id, type: 'message', ...plainMessage });
        if (plan) {
          timeline.push({ id: `plan-decision-${id}`, type: 'plan_decision', status: 'pending', plan: plainMessage.text });
        }
      }
      const activity = activityFromRecord(record);
      if (activity) {
        timeline.push(activity);
        if (activity.type === 'command') {
          commands.set(activity.id, activity);
          if (activity.files?.length) timeline.push({ id: `file-change-${activity.id}`, type: 'file_change', status: activity.status, files: activity.files });
        }
      }
      if (record.type === 'response_item' && ['custom_tool_call_output', 'function_call_output', 'tool_call_output', 'called_output'].includes(String(payload?.type || '').replace(/([a-z])([A-Z])/g, '$1_$2').replace(/-/g, '_').toLowerCase())) {
        const command = commands.get(payload.call_id || payload.callId);
        if (command) command.output = textFromToolOutput(payload.output);
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

module.exports = { parseSessionLines };
