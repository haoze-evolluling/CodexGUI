import { useEffect, useMemo, useState } from 'react';
import { freshSession, groupSessions, normalizeSession, timelineOf } from './session-model';
import type { AttachmentKind, CodexAttachment, CodexModel, CollaborationMode, Message, PermissionMode, Session, UserInputActivity } from './types';

const imageExtensions = new Set(['bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp']);
const codeExtensions = new Set(['c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'json', 'jsx', 'kt', 'md', 'php', 'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'swift', 'toml', 'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml']);
const documentExtensions = new Set(['doc', 'docx', 'odt', 'rtf', 'txt']);
const spreadsheetExtensions = new Set(['csv', 'ods', 'xls', 'xlsx']);
const archiveExtensions = new Set(['7z', 'gz', 'rar', 'tar', 'zip']);

const attachmentKind = (fileName: string): AttachmentKind => {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  if (imageExtensions.has(extension)) return 'image';
  if (codeExtensions.has(extension)) return 'code';
  if (extension === 'pdf') return 'pdf';
  if (documentExtensions.has(extension)) return 'document';
  if (spreadsheetExtensions.has(extension)) return 'spreadsheet';
  if (archiveExtensions.has(extension)) return 'archive';
  return 'file';
};

const without = (items: Set<string>, value: string) => {
  const next = new Set(items);
  next.delete(value);
  return next;
};

export function useSessionController() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session>();
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<CodexAttachment[]>([]);
  const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set());
  const [waitingSessions, setWaitingSessions] = useState<Set<string>>(new Set());
  const [compactingSessions, setCompactingSessions] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<CodexModel[]>([]);
  const [collaborationModes, setCollaborationModes] = useState<CollaborationMode[]>([]);
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>('default');

  const refreshHistory = async () => {
    const items = await window.codex.loadHistory();
    if (!items) return;
    const normalized = items.map(normalizeSession);
    setSessions(normalized);
    setActive(current => normalized.find(item => item.id === current?.id) || normalized[0]);
  };

  useEffect(() => {
    refreshHistory();
    window.codex.listModels().then(setModels).catch(() => setModels([]));
    window.codex.listCollaborationModes().then(setCollaborationModes).catch(() => setCollaborationModes([]));
    window.codex.getSettings().then(settings => setPermissionModeState(settings.permissionMode)).catch(() => setPermissionModeState('default'));
    const refreshInterval = window.setInterval(refreshHistory, 60_000);

    const updateSession = (sessionId: string, update: (session: Session) => Session) => {
      setSessions(items => items.map(session => {
        if (session.id !== sessionId) return session;
        const next = update(normalizeSession(session));
        window.codex.saveSession(next);
        return next;
      }));
      setActive(current => current?.id === sessionId ? update(normalizeSession(current)) : current);
    };
    const appendMessage = (sessionId: string, message: Message) => updateSession(sessionId, session => ({
      ...session,
      timeline: [...timelineOf(session), { id: crypto.randomUUID(), type: 'message', ...message }],
      updated: Date.now(),
    }));

    const unsubscribe = [
      window.codex.onData(value => updateSession(value.sessionId, session => {
        const timeline = [...timelineOf(session)];
        const id = `agent-${value.itemId}`;
        const index = timeline.findIndex(item => item.id === id);
        if (index >= 0 && timeline[index].type === 'message') {
          timeline[index] = { ...timeline[index], text: value.full ? value.text : timeline[index].text + value.text };
        } else timeline.push({ id, type: 'message', role: 'assistant', text: value.text });
        return { ...session, timeline, updated: Date.now() };
      })),
      window.codex.onActivity(value => updateSession(value.sessionId, session => {
        const timeline = [...timelineOf(session)];
        const index = timeline.findIndex(item => item.id === value.activity.id);
        if (index >= 0) timeline[index] = { ...timeline[index], ...value.activity } as typeof value.activity;
        else timeline.push(value.activity);
        return { ...session, timeline, updated: Date.now() };
      })),
      window.codex.onThread(value => updateSession(value.sessionId, session => ({ ...session, threadId: value.threadId }))),
      window.codex.onExit(value => setRunningSessions(current => without(current, value.sessionId))),
      window.codex.onError(value => {
        setRunningSessions(current => without(current, value.sessionId));
        setCompactingSessions(current => without(current, value.sessionId));
        appendMessage(value.sessionId, { role: 'error', text: value.error });
      }),
      window.codex.onCompacted(value => setCompactingSessions(current => without(current, value.sessionId))),
      window.codex.onStatus(value => setWaitingSessions(current => {
        const next = new Set(current);
        if (value.status.type === 'active' && value.status.activeFlags?.includes('waitingOnUserInput')) next.add(value.sessionId);
        else next.delete(value.sessionId);
        return next;
      })),
      window.codex.onUserInput(value => updateSession(value.sessionId, session => ({
        ...session,
        timeline: [...timelineOf(session), {
          id: value.request.itemId, type: 'user_input', status: 'pending', questions: value.request.questions,
        }],
        updated: Date.now(),
      }))),
    ];
    return () => {
      window.clearInterval(refreshInterval);
      unsubscribe.forEach(removeListener => removeListener());
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    setSessions(items => [active, ...items.filter(item => item.id !== active.id)]);
    window.codex.saveSession(active);
  }, [active]);

  const appendLocalError = (text: string) => setActive(current => current ? ({
    ...current,
    timeline: [...timelineOf(current), { id: crypto.randomUUID(), type: 'message', role: 'error', text }],
  }) : current);

  const send = async () => {
    if ((!input.trim() && !attachments.length) || !active || runningSessions.has(active.id)) return;
    const text = input.trim();
    const sentAttachments = attachments;
    setInput('');
    setAttachments([]);
    if (!active.cwd) {
      appendLocalError('请先选择项目文件夹。');
      return;
    }
    setActive({
      ...active,
      timeline: [...timelineOf(active), { id: crypto.randomUUID(), type: 'message', role: 'user', text, attachments: sentAttachments }],
      title: active.title === '新建对话' ? (text || sentAttachments[0]?.name || '附件').slice(0, 32) : active.title,
    });
    setRunningSessions(current => new Set(current).add(active.id));
    const selectedModel = models.find(model => model.isDefault) || models[0];
    const effectiveModel = active.model || selectedModel?.model;
    const effectiveEffort = active.reasoningEffort || selectedModel?.defaultReasoningEffort;
    const started = await window.codex.start({
      sessionId: active.id, cwd: active.cwd, prompt: text, attachments: sentAttachments, threadId: active.threadId,
      model: effectiveModel, reasoningEffort: effectiveEffort,
      collaborationMode: collaborationModes.find(mode => mode.mode === (active.collaborationMode || 'default')),
      permissionMode,
    });
    if (!started) setRunningSessions(current => without(current, active.id));
  };

  const compact = async () => {
    if (!active?.threadId || runningSessions.has(active.id) || compactingSessions.has(active.id)) return;
    setCompactingSessions(current => new Set(current).add(active.id));
    try {
      if (!await window.codex.compact(active.id, active.threadId)) throw new Error('无法开始压缩。');
    } catch (error) {
      setCompactingSessions(current => without(current, active.id));
      appendLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const answerUserInput = async (activity: UserInputActivity, answers: Record<string, { answers: string[] }>) => {
    if (!await window.codex.answerUserInput(activity.id, answers)) return;
    setActive(current => current ? {
      ...current,
      timeline: timelineOf(current).map(item => item.id === activity.id ? { ...activity, status: 'answered', answers } : item),
    } : current);
  };

  const createInFolder = (cwd: string) => setActive(freshSession(cwd));
  const createProjectSession = async () => { const cwd = await window.codex.chooseFolder(); if (cwd) createInFolder(cwd); };
  const chooseFiles = async () => {
    if (!active) return;
    const filePaths = await window.codex.chooseFiles(active.cwd);
    if (!filePaths.length) return;
    setAttachments(current => {
      const knownPaths = new Set(current.map(attachment => attachment.path.toLowerCase()));
      const added: CodexAttachment[] = [];
      for (const filePath of filePaths) {
        const normalizedPath = filePath.toLowerCase();
        if (knownPaths.has(normalizedPath)) continue;
        knownPaths.add(normalizedPath);
        const name = filePath.split(/[/\\]/).pop() || filePath;
        added.push({ id: crypto.randomUUID(), path: filePath, name, kind: attachmentKind(name) });
      }
      return [...current, ...added];
    });
  };
  const clearContext = async () => {
    if (!active || runningSessions.has(active.id) || compactingSessions.has(active.id)) return;
    const sessionId = active.id;
    setInput('');
    setAttachments([]);
    setRunningSessions(current => without(current, sessionId));
    setWaitingSessions(current => without(current, sessionId));
    setCompactingSessions(current => without(current, sessionId));
    setActive(current => current ? {
      ...current,
      title: '新建对话',
      messages: undefined,
      timeline: [{
        id: crypto.randomUUID(),
        type: 'message',
        role: 'system',
        text: '上下文已清除，可以开始新的对话。',
      }],
      threadId: undefined,
      updated: Date.now(),
    } : current);
    try {
      if (!await window.codex.resetSession(sessionId)) {
        appendLocalError('后端会话重置失败，请重新发送消息。');
      }
    } catch (error) {
      appendLocalError(error instanceof Error ? error.message : String(error));
    }
  };
  const archiveSession = async (target = active) => {
    if (!target || runningSessions.has(target.id)) return;
    if (!window.confirm(`归档“${target.title}”后，它将从本软件的列表移除。是否继续？`)) return;
    const archived = await window.codex.archiveSession(target);
    if (!archived.ok) { window.alert(`归档失败：${archived.error || '未知错误'}`); return; }
    const remaining = sessions.filter(session => session.id !== target.id && (!target.threadId || session.threadId !== target.threadId));
    setSessions(remaining);
    setActive(current => current && (current.id === target.id || (target.threadId && current.threadId === target.threadId)) ? remaining[0] : current);
  };
  const archiveProject = async (cwd: string, projectSessions: Session[]) => {
    if (projectSessions.some(session => runningSessions.has(session.id))) return;
    const name = cwd.split(/[/\\]/).filter(Boolean).pop() || cwd;
    if (!window.confirm(`归档项目“${name}”中的全部 ${projectSessions.length} 个对话？它们将从本软件的列表移除。`)) return;
    const archived = await window.codex.archiveProject(projectSessions);
    if (!archived.ok) { window.alert(`归档失败：${archived.error || '未知错误'}`); return; }
    const ids = new Set(projectSessions.map(session => session.id));
    const remaining = sessions.filter(session => !ids.has(session.id));
    setSessions(remaining);
    setActive(current => current && ids.has(current.id) ? remaining[0] : current);
  };
  const toggleGroup = (cwd: string) => setCollapsedGroups(current => {
    const next = new Set(current); if (next.has(cwd)) next.delete(cwd); else next.add(cwd); return next;
  });
  const setModel = (model: string) => {
    const selected = models.find(item => item.model === model);
    setActive(current => current ? { ...current, model, reasoningEffort: selected?.defaultReasoningEffort } : current);
  };
  const setPermissionMode = (mode: PermissionMode) => {
    const previous = permissionMode;
    setPermissionModeState(mode);
    window.codex.saveSettings({ permissionMode: mode }).catch(() => {
      setPermissionModeState(current => current === mode ? previous : current);
    });
  };

  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const running = !!active && runningSessions.has(active.id);
  const waiting = !!active && waitingSessions.has(active.id);
  const compacting = !!active && compactingSessions.has(active.id);
  return {
    active, answerUserInput, archiveProject, archiveSession, attachments, chooseFiles, clearContext, collapsedGroups, collaborationModes, compact, compacting, permissionMode,
    createInFolder, createProjectSession, groups, input, models, refreshHistory, removeAttachment: (id: string) => setAttachments(current => current.filter(attachment => attachment.id !== id)), running, runningSessions, send, setActive,
    setCollaborationMode: (mode: 'default' | 'plan') => setActive(current => current ? { ...current, collaborationMode: mode } : current),
    setInput, setModel, setPermissionMode,
    setReasoningEffort: (effort: string) => setActive(current => current ? { ...current, reasoningEffort: effort } : current),
    toggleGroup, waiting,
  };
}
