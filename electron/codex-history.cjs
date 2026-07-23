const fs = require('fs');
const path = require('path');
const { activityFromRecord, messageFromRecord, tokenUsageFromRecord } = require('./codex-history-records.cjs');

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

function loadCodexHistory(codexHome, directory = 'sessions') {
  const sessionsRoot = path.join(codexHome, directory);
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

function timelineLength(timeline) {
  return Array.isArray(timeline) ? timeline.length : 0;
}

function activityCount(timeline) {
  if (!Array.isArray(timeline)) return 0;
  return timeline.filter(item => item && item.type && item.type !== 'message').length;
}

function shouldPreferImportedTimeline(savedTimeline, importedTimeline, importedIsCurrent) {
  const savedLength = timelineLength(savedTimeline);
  const importedLength = timelineLength(importedTimeline);
  const savedActivities = activityCount(savedTimeline);
  const importedActivities = activityCount(importedTimeline);
  if (!importedLength && savedLength) return false;
  // Live GUI timelines often contain command/file activities that are delayed or
  // incomplete in on-disk Codex transcripts. Never drop richer activity content.
  if (savedActivities > importedActivities) return false;
  if (importedIsCurrent) {
    return importedLength > savedLength
      || (importedLength === savedLength && importedActivities >= savedActivities && importedLength > 0);
  }
  return importedLength > savedLength
    || (importedLength === savedLength && importedActivities > savedActivities);
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
    const importedIsCurrent = (importedSession.updated || 0) >= (session.updated || 0);
    const useImportedTimeline = hasImportedTimeline
      && shouldPreferImportedTimeline(savedTimeline, importedTimeline, importedIsCurrent);
    return {
      ...session,
      ...(useImportedTimeline ? {
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
