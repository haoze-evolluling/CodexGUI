import { useEffect, useMemo, useState } from 'react';
import { freshSession, groupSessions, normalizeSession, timelineOf } from './session-model';
import type { Message, Session } from './types';

export function useSessionController() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session>();
  const [input, setInput] = useState('');
  const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const refreshHistory = async () => {
    const items = await window.codex.loadHistory();
    if (!items) return;
    const normalized = items.map(normalizeSession);
    setSessions(normalized);
    setActive(current => normalized.find(item => item.id === current?.id) || normalized[0]);
  };

  useEffect(() => {
    refreshHistory();
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
      timeline: [
        ...timelineOf(session),
        { id: crypto.randomUUID(), type: 'message', ...message },
      ],
      updated: Date.now(),
    }));

    const unsubscribe = [
      window.codex.onData(value => appendMessage(value.sessionId, {
        role: value.stream === 'stderr' ? 'error' : 'assistant',
        text: value.text,
      })),
      window.codex.onActivity(value => updateSession(value.sessionId, session => {
        const timeline = [...timelineOf(session)];
        const index = timeline.findIndex(item => item.id === value.activity.id);
        if (index >= 0) timeline[index] = { ...timeline[index], ...value.activity } as typeof value.activity;
        else timeline.push(value.activity);
        return { ...session, timeline, updated: Date.now() };
      })),
      window.codex.onThread(value => updateSession(value.sessionId, session => ({
        ...session,
        threadId: value.threadId,
      }))),
      window.codex.onExit(value => setRunningSessions(current => {
        const next = new Set(current);
        next.delete(value.sessionId);
        return next;
      })),
      window.codex.onError(value => {
        setRunningSessions(current => {
          const next = new Set(current);
          next.delete(value.sessionId);
          return next;
        });
        appendMessage(value.sessionId, { role: 'error', text: value.error });
      }),
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

  const send = async () => {
    if (!input.trim() || !active || runningSessions.has(active.id)) return;
    const text = input.trim();
    setInput('');
    if (!active.cwd) {
      setActive({
        ...active,
        timeline: [
          ...timelineOf(active),
          { id: crypto.randomUUID(), type: 'message', role: 'system', text: '请先选择项目文件夹。' },
        ],
      });
      return;
    }
    setActive({
      ...active,
      timeline: [
        ...timelineOf(active),
        { id: crypto.randomUUID(), type: 'message', role: 'user', text },
      ],
      title: active.title === '新建对话' ? text.slice(0, 32) : active.title,
    });
    setRunningSessions(current => new Set(current).add(active.id));
    const started = await window.codex.start({
      sessionId: active.id,
      cwd: active.cwd,
      prompt: text,
      threadId: active.threadId,
    });
    if (!started) {
      setRunningSessions(current => {
        const next = new Set(current);
        next.delete(active.id);
        return next;
      });
    }
  };

  const createInFolder = (cwd: string) => setActive(freshSession(cwd));

  const createProjectSession = async () => {
    const cwd = await window.codex.chooseFolder();
    if (cwd) createInFolder(cwd);
  };

  const archiveSession = async (target = active) => {
    if (!target || runningSessions.has(target.id)) return;
    const description = `归档“${target.title}”后，它将从本软件的列表移除。是否继续？`;
    if (!window.confirm(description)) return;
    const archived = await window.codex.archiveSession(target);
    if (!archived.ok) {
      window.alert(`归档失败：${archived.error || '未知错误'}`);
      return;
    }
    const remaining = sessions.filter(session =>
      session.id !== target.id && (!target.threadId || session.threadId !== target.threadId));
    setSessions(remaining);
    setActive(current => current && (
      current.id === target.id || (target.threadId && current.threadId === target.threadId)
    ) ? remaining[0] : current);
  };

  const archiveProject = async (cwd: string, projectSessions: Session[]) => {
    if (projectSessions.some(session => runningSessions.has(session.id))) return;
    const name = cwd.split(/[/\\]/).filter(Boolean).pop() || cwd;
    if (!window.confirm(`归档项目“${name}”中的全部 ${projectSessions.length} 个对话？它们将从本软件的列表移除。`)) return;
    const archived = await window.codex.archiveProject(projectSessions);
    if (!archived.ok) {
      window.alert(`归档失败：${archived.error || '未知错误'}`);
      return;
    }
    const ids = new Set(projectSessions.map(session => session.id));
    const remaining = sessions.filter(session => !ids.has(session.id));
    setSessions(remaining);
    setActive(current => current && ids.has(current.id) ? remaining[0] : current);
  };

  const toggleGroup = (cwd: string) => setCollapsedGroups(current => {
    const next = new Set(current);
    if (next.has(cwd)) next.delete(cwd);
    else next.add(cwd);
    return next;
  });

  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const running = !!active && runningSessions.has(active.id);

  return {
    active,
    archiveProject,
    archiveSession,
    collapsedGroups,
    createInFolder,
    createProjectSession,
    groups,
    input,
    refreshHistory,
    running,
    runningSessions,
    send,
    setActive,
    setInput,
    toggleGroup,
  };
}
