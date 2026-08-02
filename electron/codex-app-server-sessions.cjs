const { tokenUsageFromThread } = require('./codex-token-usage.cjs');
const { isCommandOutput } = require('./codex-app-server-support.cjs');

function createThreadSessionMapper({ activityFromItem, attachDiffs }) {
  const updatedAt = value => Number.isFinite(value) ? value * 1_000 : Date.parse(value || '') || Date.now();

  const attachmentsFromContent = content => (content || []).flatMap((part, index) => {
    if (!part || (part.type !== 'mention' && part.type !== 'localImage') || typeof part.path !== 'string' || !part.path) return [];
    const name = typeof part.name === 'string' && part.name ? part.name : part.path.split(/[\\/]/).pop() || part.path;
    return [{ id: `${part.type}-${index}-${part.path}`, path: part.path, name, kind: part.type === 'localImage' ? 'image' : 'file' }];
  });

  async function timelineFromTurns(turns, cwd) {
    const timeline = (turns || []).flatMap(turn => {
      const toolOutputs = new Map((turn.items || [])
        .filter(item => isCommandOutput(item) && (item.callId || item.call_id))
        .map(item => [item.callId || item.call_id, item.output ?? item.aggregatedOutput ?? item.aggregated_output]));
      return (turn.items || []).flatMap(item => {
        if (item.type === 'userMessage') {
          const text = (item.content || [])
            .filter(part => (part?.type === 'text' || part?.type === 'inputText') && typeof part.text === 'string')
            .map(part => part.text)
            .join('\n');
          const attachments = attachmentsFromContent(item.content);
          return text || attachments.length
            ? [{ id: item.id, type: 'message', role: 'user', text, ...(attachments.length ? { attachments } : {}) }]
            : [];
        }
        if (item.type === 'agentMessage' && typeof item.text === 'string') {
          return [{ id: item.id, type: 'message', role: 'assistant', text: item.text }];
        }
        if (item.type === 'plan' && typeof item.text === 'string') {
          // A plan is part of the Codex thread, not renderer-only state. Keep
          // both its conversational text and the decision UI derivable from it.
          return [
            { id: item.id, type: 'message', role: 'assistant', text: item.text },
            { id: `plan-decision-${item.id}`, type: 'plan_decision', status: 'pending', plan: item.text },
          ];
        }
        if (isCommandOutput(item)) return [];
        const activity = activityFromItem(item, item.status || 'completed', toolOutputs.get(item.callId || item.call_id));
        return activity ? [activity] : [];
      });
    });
    return Promise.all(timeline.map(async item => {
      if (item.type !== 'file_change' || item.status !== 'completed') return item;
      return { ...item, files: await attachDiffs(cwd || process.cwd(), item.files) };
    }));
  }

  async function sessionFromThread(thread) {
    const tokenUsage = tokenUsageFromThread(thread);
    return {
      id: `codex-${thread.id}`,
      threadId: thread.id,
      cwd: typeof thread.cwd === 'string' ? thread.cwd : '',
      title: thread.name || thread.preview || '未命名对话',
      // thread/list deliberately omits turns. Do not represent that as an empty
      // transcript, or a metadata refresh can erase an already loaded timeline.
      ...(Array.isArray(thread.turns) ? { timeline: await timelineFromTurns(thread.turns, thread.cwd) } : {}),
      ...(tokenUsage ? { tokenUsage } : {}),
      updated: updatedAt(thread.updatedAt || thread.updated_at),
    };
  }

  return { sessionFromThread, timelineFromTurns };
}

module.exports = { createThreadSessionMapper };
