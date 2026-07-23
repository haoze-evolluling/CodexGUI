import { useEffect, useMemo, useRef, useState } from 'react';
import { freshSession, groupSessions, normalizeSession, shouldKeepLiveTimeline, timelineOf } from './session-model';
import type { AppSettings, CodexAttachment, CodexInstallation, CodexModel, CodexSkill, CollaborationMode, FontSize, PermissionMode, PlanDecisionActivity, SaveCodexPathResult, Session, ThemeMode, UserInputActivity } from './types';
import type { AppDialogState } from './components/AppDialog';
import { addUniqueAttachments } from './attachment-utils';
import { without } from './session-set-utils';
import { resolveModel, resolveReasoningEffort } from './model-utils';
import { useSessionEvents } from './use-session-events';
import { createSessionStatusDialog } from './session-status-dialog';

export function useSessionController() {
  const initialTheme = document.documentElement.dataset.initialTheme === 'dark' ? 'dark' : 'light';
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
  const [skills, setSkills] = useState<CodexSkill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<CodexSkill>();
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>('default');
  const [dialog, setDialog] = useState<AppDialogState>();
  const [settings, setSettings] = useState<AppSettings>({ permissionMode: 'default', fontSize: 'small', theme: initialTheme, historyRefreshIntervalSeconds: 10 });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivedSessions, setArchivedSessions] = useState<Session[]>([]);
  const projectFilesCache = useRef<Map<string, string[]>>(new Map());
  const [installation, setInstallation] = useState<CodexInstallation>();
  const settingsRef = useRef(settings);
  const runningSessionsRef = useRef(runningSessions);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    runningSessionsRef.current = runningSessions;
  }, [runningSessions]);

  const rememberProjects = (projectPaths: string[]) => {
    const current = settingsRef.current;
    const nextProjectPaths = [...new Set([
      ...(current.projectPaths || []),
      ...projectPaths.filter(Boolean),
    ])];
    if (nextProjectPaths.length === (current.projectPaths || []).length) return;
    const next = { ...current, projectPaths: nextProjectPaths };
    settingsRef.current = next;
    setSettings(next);
    window.codex.saveSettings({ projectPaths: nextProjectPaths }).then(saved => {
      settingsRef.current = saved;
      setSettings(saved);
    }).catch(() => undefined);
  };

  const openSettings = () => {
    setDialog(undefined);
    setArchiveOpen(false);
    setSettingsOpen(true);
    window.codex.getCodexInstallation().then(setInstallation).catch(() => undefined);
  };

  const showMissingCodex = (current: CodexInstallation) => {
    setInstallation(current);
    if (current.status === 'ready') return;
    setDialog({
      title: current.status === 'invalid' ? 'Codex 路径无效' : '未找到 Codex',
      description: current.error,
      details: [{ label: '安装命令', value: 'npm install -g @openai/codex' }],
      confirmLabel: '打开设置',
      cancelLabel: '稍后',
      onConfirm: openSettings,
    });
  };

  const refreshHistory = async () => {
    const items = await window.codex.loadHistory();
    if (!items) return;
    const normalized = items.map(normalizeSession);
    rememberProjects(normalized.map(item => item.cwd));
    setSessions(current => {
      const liveById = new Map(current.map(session => [session.id, session]));
      const liveByThread = new Map(
        current
          .filter(session => session.threadId)
          .map(session => [session.threadId as string, session]),
      );
      const matchedLiveIds = new Set<string>();
      const merged = normalized.map(session => {
        const live = liveById.get(session.id)
          || (session.threadId ? liveByThread.get(session.threadId) : undefined);
        if (!live) return session;
        matchedLiveIds.add(live.id);
        const liveTimeline = timelineOf(live);
        const nextTimeline = timelineOf(session);
        const keepLiveTimeline = shouldKeepLiveTimeline(liveTimeline, nextTimeline, {
          running: runningSessionsRef.current.has(live.id),
          liveUpdated: live.updated,
          incomingUpdated: session.updated,
        });
        if (!keepLiveTimeline) {
          return {
            ...session,
            id: live.id,
            title: live.title || session.title,
            model: live.model || session.model,
            reasoningEffort: live.reasoningEffort || session.reasoningEffort,
            collaborationMode: live.collaborationMode || session.collaborationMode,
          };
        }
        return {
          ...session,
          id: live.id,
          title: live.title || session.title,
          model: live.model || session.model,
          reasoningEffort: live.reasoningEffort || session.reasoningEffort,
          collaborationMode: live.collaborationMode || session.collaborationMode,
          threadStatus: live.threadStatus || session.threadStatus,
          timeline: liveTimeline,
          messages: undefined,
          tokenUsage: session.tokenUsage || live.tokenUsage,
          updated: Math.max(live.updated || 0, session.updated || 0),
        };
      });
      const liveOnly = current.filter(session =>
        !matchedLiveIds.has(session.id)
        && (runningSessionsRef.current.has(session.id) || !session.threadId),
      );
      return [...liveOnly, ...merged];
    });
    setActive(current => {
      if (!current) return normalized[0];
      const fromHistory = normalized.find(item => item.id === current.id)
        || (current.threadId ? normalized.find(item => item.threadId === current.threadId) : undefined);
      if (!fromHistory) return current;
      const liveTimeline = timelineOf(current);
      const historyTimeline = timelineOf(fromHistory);
      const keepLiveTimeline = shouldKeepLiveTimeline(liveTimeline, historyTimeline, {
        running: runningSessionsRef.current.has(current.id),
        liveUpdated: current.updated,
        incomingUpdated: fromHistory.updated,
      });
      if (!keepLiveTimeline) {
        return {
          ...fromHistory,
          id: current.id,
          title: current.title || fromHistory.title,
          model: current.model || fromHistory.model,
          reasoningEffort: current.reasoningEffort || fromHistory.reasoningEffort,
          collaborationMode: current.collaborationMode || fromHistory.collaborationMode,
        };
      }
      return {
        ...fromHistory,
        id: current.id,
        title: current.title || fromHistory.title,
        model: current.model || fromHistory.model,
        reasoningEffort: current.reasoningEffort || fromHistory.reasoningEffort,
        collaborationMode: current.collaborationMode || fromHistory.collaborationMode,
        threadStatus: current.threadStatus || fromHistory.threadStatus,
        timeline: liveTimeline,
        messages: undefined,
        tokenUsage: fromHistory.tokenUsage || current.tokenUsage,
        updated: Math.max(current.updated || 0, fromHistory.updated || 0),
      };
    });
  };

  useSessionEvents({
    historyRefreshIntervalSeconds: settings.historyRefreshIntervalSeconds,
    refreshHistory,
    showMissingCodex,
    setActive,
    setCollaborationModes,
    setCompactingSessions,
    setModels,
    setPermissionMode: setPermissionModeState,
    setRunningSessions,
    setSessions,
    setSettings,
    setWaitingSessions,
  });

  useEffect(() => {
    if (!active) return;
    setSessions(items => [active, ...items.filter(item => item.id !== active.id)]);
    window.codex.rememberSessionTitle(active.id, active.title).catch(() => undefined);
  }, [active]);

  useEffect(() => {
    const unsubscribe = window.codex.onFocusSession(value => {
      setArchiveOpen(false);
      setSettingsOpen(false);
      setSessions(items => {
        const match = items.find(item => item.id === value.sessionId);
        if (match) setActive(match);
        return items;
      });
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const cwd = active?.cwd;
    let current = true;
    setSelectedSkill(undefined);
    if (!cwd) {
      setSkills([]);
      return;
    }
    const loadSkills = (forceReload = false) => {
      window.codex.listSkills(cwd, forceReload).then(items => {
        if (!current) return;
        setSkills(items);
        setSelectedSkill(selected => selected && items.some(skill => skill.path === selected.path) ? selected : undefined);
      }).catch(() => {
        if (!current) return;
        setSkills([]);
        setSelectedSkill(undefined);
      });
    };
    loadSkills();
    const unsubscribe = window.codex.onSkillsChanged(() => loadSkills(true));
    return () => {
      current = false;
      unsubscribe();
    };
  }, [active?.cwd]);

  const appendLocalError = (text: string) => setActive(current => current ? ({
    ...current,
    timeline: [...timelineOf(current), { id: crypto.randomUUID(), type: 'message', role: 'error', text }],
  }) : current);

  const send = async (message = input) => {
    if ((!message.trim() && !attachments.length) || !active || runningSessions.has(active.id)) return;
    const text = message.trim();
    const skillPrefix = selectedSkill ? `/${selectedSkill.name}` : '';
    const prompt = message === input && selectedSkill && (text === skillPrefix || text.startsWith(`${skillPrefix} `))
      ? text.slice(skillPrefix.length).trimStart()
      : text;
    const sentSkill = prompt === text ? undefined : selectedSkill;
    const sentAttachments = attachments;
    setInput('');
    setAttachments([]);
    setSelectedSkill(undefined);
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
    const selectedModel = resolveModel(models, active.model, settings.model);
    const effectiveModel = active.model || settings.model || selectedModel?.model;
    const effectiveEffort = resolveReasoningEffort(active.reasoningEffort, selectedModel);
    const started = await window.codex.start({
      sessionId: active.id, cwd: active.cwd, prompt, attachments: sentAttachments, skill: sentSkill, threadId: active.threadId,
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

  const rollback = async () => {
    if (!active?.threadId || runningSessions.has(active.id) || compactingSessions.has(active.id)) return;
    const threadId = active.threadId;
    const target = active;
    try {
      if (!await window.codex.rollback(target.id, threadId)) throw new Error('无法撤销最近一轮对话。');
      await refreshHistory();
    } catch (error) {
      setDialog({
        title: '撤销失败',
        description: error instanceof Error ? error.message : String(error),
        onConfirm: () => setDialog(undefined),
      });
    }
  };

  const answerUserInput = async (activity: UserInputActivity, answers: Record<string, { answers: string[] }>) => {
    if (!await window.codex.answerUserInput(activity.id, answers)) return;
    setActive(current => current ? {
      ...current,
      timeline: timelineOf(current).map(item => item.id === activity.id ? { ...activity, status: 'answered', answers } : item),
    } : current);
  };

  const choosePlanAction = async (activity: PlanDecisionActivity, choice: NonNullable<PlanDecisionActivity['choice']>) => {
    if (!active || runningSessions.has(active.id)) return;
    const answeredTimeline = timelineOf(active).map(item => item.id === activity.id
      ? { ...activity, status: 'answered' as const, choice }
      : item);
    if (choice === 'stay') {
      setActive({ ...active, timeline: answeredTimeline, collaborationMode: 'plan', updated: Date.now() });
      return;
    }

    const fresh = choice === 'fresh';
    const text = fresh ? '清除上下文并执行该计划。' : '执行该计划。';
    const prompt = fresh
      ? `${text}\n\n最后一次回答的方案：\n\n${activity.plan}`
      : '请按照刚才制定的计划开始实施。';
    if (!active.cwd) {
      appendLocalError('请先选择项目文件夹。');
      return;
    }

    const answeredSession = { ...active, timeline: answeredTimeline, updated: Date.now() };
    const nextSession: Session = fresh
      ? {
          ...freshSession(active.cwd),
          title: text,
          model: active.model,
          reasoningEffort: active.reasoningEffort,
          timeline: [{ id: crypto.randomUUID(), type: 'message', role: 'user', text: prompt }],
        }
      : {
          ...answeredSession,
          collaborationMode: 'default',
          timeline: [...answeredTimeline, { id: crypto.randomUUID(), type: 'message', role: 'user', text }],
        };
    if (fresh) {
      setSessions(current => current.map(session => session.id === active.id ? answeredSession : session));
    }
    setActive(nextSession);
    setRunningSessions(current => new Set(current).add(nextSession.id));
    const selectedModel = resolveModel(models, active.model, settings.model);
    const model = active.model || settings.model || selectedModel?.model;
    const reasoningEffort = resolveReasoningEffort(active.reasoningEffort, selectedModel);
    const started = await window.codex.start({
      sessionId: nextSession.id,
      cwd: active.cwd,
      prompt,
      attachments: [],
      threadId: fresh ? undefined : active.threadId,
      model,
      reasoningEffort,
      collaborationMode: collaborationModes.find(mode => mode.mode === 'default'),
      permissionMode,
    });
    if (!started) setRunningSessions(current => without(current, nextSession.id));
  };

  const createInFolder = (cwd: string) => {
    rememberProjects([cwd]);
    setActive({
      ...freshSession(cwd),
      ...(settings.model ? { model: settings.model } : {}),
      ...(settings.reasoningEffort ? { reasoningEffort: settings.reasoningEffort } : {}),
    });
  };
  const createProjectSession = async () => { const cwd = await window.codex.chooseFolder(); if (cwd) createInFolder(cwd); };
  const moveProject = (cwd: string, direction: 'up' | 'down') => {
    const projectPaths = groupSessions(sessions, settingsRef.current.projectPaths)
      .map(group => group.cwd)
      .filter(Boolean);
    const currentIndex = projectPaths.indexOf(cwd);
    const targetIndex = currentIndex + (direction === 'up' ? -1 : 1);
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= projectPaths.length) return;

    [projectPaths[currentIndex], projectPaths[targetIndex]] = [projectPaths[targetIndex], projectPaths[currentIndex]];
    const nextSettings = { ...settingsRef.current, projectPaths };
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    window.codex.saveSettings({ projectPaths }).then(saved => {
      settingsRef.current = saved;
      setSettings(saved);
    }).catch(() => undefined);
  };
  const addFiles = (filePaths: string[]) => {
    if (!filePaths.length) return;
    setAttachments(current => addUniqueAttachments(current, filePaths));
  };
  const chooseFiles = async () => {
    if (!active) return;
    addFiles(await window.codex.chooseFiles(active.cwd));
  };
  const clearContext = async () => {
    if (!active || runningSessions.has(active.id) || compactingSessions.has(active.id)) return;
    const sessionId = active.id;
    setInput('');
    setAttachments([]);
    setSelectedSkill(undefined);
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
      threadStatus: undefined,
      tokenUsage: undefined,
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
    await performArchiveSession(target);
  };
  const performArchiveSession = async (target: Session) => {
    const archived = await window.codex.archiveSession(target);
    if (!archived.ok) {
      setDialog({ title: '归档失败', description: archived.error || '未知错误', onConfirm: () => setDialog(undefined) });
      return;
    }
    const remaining = sessions.filter(session => session.id !== target.id && (!target.threadId || session.threadId !== target.threadId));
    setSessions(remaining);
    setActive(current => current && (current.id === target.id || (target.threadId && current.threadId === target.threadId)) ? remaining[0] : current);
  };
  const archiveProject = async (cwd: string, projectSessions: Session[]) => {
    if (projectSessions.some(session => runningSessions.has(session.id))) return;
    await performArchiveProject(projectSessions);
  };
  const renameSession = (target: Session, title: string) => {
    const next = { ...target, title, updated: Date.now() };
    setSessions(current => current.map(session => session.id === target.id ? next : session));
    if (active?.id === target.id) {
      setActive(next);
      return;
    }
  };
  const deleteProject = async (cwd: string, projectSessions: Session[]) => {
    if (projectSessions.some(session => runningSessions.has(session.id))) return;
    setDialog({
      title: '删除项目',
      description: `将删除“${cwd.split(/[/\\\\]/).filter(Boolean).pop() || cwd}”及其 ${projectSessions.length} 个对话记录。项目文件不会被删除。`,
      confirmLabel: '删除项目',
      cancelLabel: '取消',
      danger: true,
      onConfirm: async () => {
        setDialog(undefined);
        let result;
        try {
          result = await window.codex.deleteProject(cwd, projectSessions);
        } catch {
          setDialog({ title: '删除失败', description: '无法删除项目，请稍后重试。', onConfirm: () => setDialog(undefined) });
          return;
        }
        if (!result.ok) {
          setDialog({ title: '删除失败', description: result.error || '未知错误', onConfirm: () => setDialog(undefined) });
          return;
        }
        const ids = new Set(projectSessions.map(session => session.id));
        const remaining = sessions.filter(session => !ids.has(session.id));
        setSessions(remaining);
        setActive(current => current && ids.has(current.id) ? remaining[0] : current);
        setCollapsedGroups(current => {
          const next = new Set(current);
          next.delete(cwd);
          return next;
        });
        const nextSettings = { ...settingsRef.current, projectPaths: (settingsRef.current.projectPaths || []).filter(projectPath => projectPath !== cwd) };
        settingsRef.current = nextSettings;
        setSettings(nextSettings);
      },
    });
  };
  const performArchiveProject = async (projectSessions: Session[]) => {
    const archived = await window.codex.archiveProject(projectSessions);
    if (!archived.ok) {
      setDialog({ title: '归档失败', description: archived.error || '未知错误', onConfirm: () => setDialog(undefined) });
      return;
    }
    const ids = new Set(projectSessions.map(session => session.id));
    const remaining = sessions.filter(session => !ids.has(session.id));
    setSessions(remaining);
    setActive(current => current && ids.has(current.id) ? remaining[0] : current);
  };
  
  const openArchive = async () => {
    setDialog(undefined);
    setSettingsOpen(false);
    setArchiveOpen(true);
    try {
      setArchivedSessions(await window.codex.listArchivedSessions());
    } catch {
      setArchivedSessions([]);
    }
  };

  const refreshArchivedSessions = async () => {
    try {
      setArchivedSessions(await window.codex.listArchivedSessions());
    } catch {
      setArchivedSessions([]);
    }
  };

  const restoreArchivedSession = async (target: Session) => {
    const result = await window.codex.restoreArchivedSession(target);
    if (!result.ok) {
      setDialog({ title: '恢复失败', description: result.error || '未知错误', onConfirm: () => setDialog(undefined) });
      return;
    }
    const restored = normalizeSession(result.session);
    setArchivedSessions(current => current.filter(session => session.id !== target.id && (!target.threadId || session.threadId !== target.threadId)));
    setSessions(current => [restored, ...current.filter(session => session.id !== restored.id && (!restored.threadId || session.threadId !== restored.threadId))]);
    setActive(restored);
    setArchiveOpen(false);
    setSettingsOpen(false);
  };

  const removeArchivedSession = async (target: Session) => {
    setDialog({
      title: '彻底移除归档',
      description: `确定从归档中移除“${target.title}”吗？此操作不会删除 Codex 原始历史文件。`,
      confirmLabel: '移除',
      cancelLabel: '取消',
      danger: true,
      onConfirm: async () => {
        setDialog(undefined);
        const result = await window.codex.removeArchivedSession(target);
        if (!result.ok) {
          setDialog({ title: '移除失败', description: result.error || '未知错误', onConfirm: () => setDialog(undefined) });
          return;
        }
        setArchivedSessions(current => current.filter(session => session.id !== target.id && (!target.threadId || session.threadId !== target.threadId)));
      },
    });
  };

  const clearArchivedSessions = () => {
    if (!archivedSessions.length) return;
    setDialog({
      title: '清空全部归档',
      description: '确定彻底移除全部归档会话吗？此操作不会删除 Codex 原始历史文件。',
      confirmLabel: '全部清除',
      cancelLabel: '取消',
      danger: true,
      onConfirm: async () => {
        setDialog(undefined);
        const result = await window.codex.clearArchivedSessions();
        if (!result.ok) {
          setDialog({ title: '清除失败', description: result.error || '未知错误', onConfirm: () => setDialog(undefined) });
          return;
        }
        setArchivedSessions([]);
      },
    });
  };

  const openPath = async (filePath: string, cwd = active?.cwd) => {
    const result = await window.codex.openPath(cwd, filePath);
    if (!result.ok) {
      setDialog({ title: '无法打开文件', description: result.error || '未知错误', onConfirm: () => setDialog(undefined) });
    }
  };

  const openInVsCode = async (filePath: string, cwd = active?.cwd) => {
    const result = await window.codex.openInVsCode(cwd, filePath);
    if (!result.ok) {
      setDialog({ title: '无法在 VS Code 中打开', description: result.error || '未知错误', onConfirm: () => setDialog(undefined) });
    }
  };

  const listMentionFiles = async (cwd: string, query: string) => {
    if (!cwd) return [] as string[];
    let files = projectFilesCache.current.get(cwd);
    if (!files) {
      files = await window.codex.listProjectFiles(cwd);
      projectFilesCache.current.set(cwd, files);
    }
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return files.slice(0, 50);
    const scored = files
      .map(file => {
        const normalized = file.toLowerCase();
        const name = normalized.split('/').pop() || normalized;
        let score = -1;
        if (name === normalizedQuery) score = 300;
        else if (name.startsWith(normalizedQuery)) score = 200;
        else if (name.includes(normalizedQuery)) score = 100;
        else if (normalized.includes(normalizedQuery)) score = 50;
        return score >= 0 ? { file, score, name } : null;
      })
      .filter((item): item is { file: string; score: number; name: string } => !!item)
      .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name) || left.file.localeCompare(right.file))
      .slice(0, 50)
      .map(item => item.file);
    return scored;
  };
  const toggleGroup = (cwd: string) => setCollapsedGroups(current => {
    const next = new Set(current); if (next.has(cwd)) next.delete(cwd); else next.add(cwd); return next;
  });
  const setModel = (model: string) => {
    const selected = resolveModel(models, model);
    const reasoningEffort = selected?.defaultReasoningEffort;
    setActive(current => current ? {
      ...current,
      model,
      reasoningEffort: reasoningEffort || current.reasoningEffort,
    } : current);
    window.codex.saveSettings({
      model,
      ...(reasoningEffort ? { reasoningEffort } : {}),
    }).then(setSettings).catch(() => undefined);
  };
  const setFontSize = (fontSize: FontSize) => {
    setSettings(current => ({ ...current, fontSize }));
    window.codex.saveSettings({ fontSize }).then(setSettings).catch(() => undefined);
  };

  const setTheme = (theme: ThemeMode) => {
    setSettings(current => ({ ...current, theme }));
    window.codex.saveSettings({ theme }).then(setSettings).catch(() => undefined);
  };

  const setPermissionMode = (mode: PermissionMode) => {
    const previous = permissionMode;
    setPermissionModeState(mode);
    window.codex.saveSettings({ permissionMode: mode }).then(value => setSettings(value)).catch(() => {
      setPermissionModeState(current => current === mode ? previous : current);
    });
  };

  const saveCodexPath = async (codexPath: string): Promise<SaveCodexPathResult> => {
    const result = await window.codex.saveCodexPath(codexPath);
    if (!result.ok) return result;
    setSettings(result.settings);
    setInstallation(result.installation);
    if (result.installation.status === 'ready') {
      window.codex.listModels().then(setModels).catch(() => setModels([]));
      window.codex.listCollaborationModes().then(setCollaborationModes).catch(() => setCollaborationModes([]));
    }
    return result;
  };
  const updateInput = (value: string) => {
    setInput(value);
    setSelectedSkill(current => current && (value === `/${current.name}` || value.startsWith(`/${current.name} `)) ? current : undefined);
  };

  const setHistoryRefreshIntervalSeconds = (historyRefreshIntervalSeconds: number) => {
    setSettings(current => ({ ...current, historyRefreshIntervalSeconds }));
    window.codex.saveSettings({ historyRefreshIntervalSeconds }).then(setSettings).catch(() => undefined);
  };
  const selectSkill = (skill: CodexSkill) => {
    setSelectedSkill(skill);
    setInput(`/${skill.name}`);
  };

  const showStatus = () => {
    if (!active) return;
    setDialog(createSessionStatusDialog({ session: active, models, preferredModel: settings.model, permissionMode, running: runningSessions.has(active.id), onClose: () => setDialog(undefined) }));
  };

  const groups = useMemo(() => groupSessions(sessions, settings.projectPaths), [sessions, settings.projectPaths]);
  const running = !!active && runningSessions.has(active.id);
  const waiting = !!active && waitingSessions.has(active.id);
  const compacting = !!active && compactingSessions.has(active.id);
  const canRollback = !!active?.threadId && !running && !compacting
    && timelineOf(active).some(item => item.type === 'message' && item.role === 'user');
  return {
    active, addFiles, answerUserInput, archiveOpen, archiveProject, archiveSession, archivedSessions, attachments, canRollback, chooseFiles, choosePlanAction, clearContext, collapsedGroups, collaborationModes, compact, compacting, deleteProject, permissionMode, dialog, closeDialog: () => setDialog(undefined),
    clearArchivedSessions, closeArchive: () => setArchiveOpen(false), closeSettings: () => setSettingsOpen(false), installation, listMentionFiles, openArchive, openInVsCode, openPath, openSettings, refreshArchivedSessions, removeArchivedSession, restoreArchivedSession, saveCodexPath, setFontSize, setTheme, settings, settingsOpen,
    createInFolder, createProjectSession, groups, input, models, moveProject, refreshHistory, removeAttachment: (id: string) => setAttachments(current => current.filter(attachment => attachment.id !== id)), renameSession, running, runningSessions, selectedSkill, selectSkill, send, setActive, setHistoryRefreshIntervalSeconds, showStatus, skills,
    setCollaborationMode: (mode: 'default' | 'plan') => setActive(current => current ? { ...current, collaborationMode: mode } : current),
    setInput: updateInput, setModel, setPermissionMode,
    setReasoningEffort: (effort: string) => {
      setActive(current => current ? { ...current, reasoningEffort: effort } : current);
      window.codex.saveSettings({ reasoningEffort: effort }).then(setSettings).catch(() => undefined);
    },
    rollback, toggleGroup, waiting,
  };
}


