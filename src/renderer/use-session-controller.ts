import { useEffect, useMemo, useRef, useState } from 'react';
import { freshSession, groupSessions, normalizeSession, timelineOf } from './session-model';
import type { AppSettings, CodexAttachment, CodexInstallation, CodexModel, CodexSkill, CollaborationMode, FontSize, PermissionMode, PlanDecisionActivity, SaveCodexPathResult, Session, ThemeMode, UserInputActivity } from './types';
import type { AppDialogState } from './components/AppDialog';
import { addUniqueAttachments } from './attachment-utils';
import { without } from './session-set-utils';
import { resolveModel, resolveReasoningEffort } from './model-utils';
import { useSessionEvents } from './use-session-events';

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
  const [installation, setInstallation] = useState<CodexInstallation>();
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

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
    setSessions(normalized);
    setActive(current => normalized.find(item => item.id === current?.id) || normalized[0]);
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
    window.codex.saveSession(active);
  }, [active]);

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
    const timeline = timelineOf(active);
    let lastUserIndex = -1;
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index];
      if (item.type === 'message' && item.role === 'user') {
        lastUserIndex = index;
        break;
      }
    }
    if (lastUserIndex < 0) return;
    const target = active;
    try {
      if (!await window.codex.rollback(target.id, target.threadId)) throw new Error('无法撤销最近一轮对话。');
      const nextTimeline = timeline.slice(0, lastUserIndex);
      const firstUserMessage = nextTimeline.find(item => item.type === 'message' && item.role === 'user');
      setActive(current => current?.id === target.id ? {
        ...current,
        title: firstUserMessage?.type === 'message'
          ? (firstUserMessage.text || firstUserMessage.attachments?.[0]?.name || '附件').slice(0, 32)
          : '新建对话',
        messages: undefined,
        timeline: nextTimeline,
        tokenUsage: undefined,
        updated: Date.now(),
      } : current);
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
      await window.codex.saveSession(answeredSession);
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
    const effortLabels: Record<string, string> = {
      minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '最高',
    };
    const statusLabels: Record<string, string> = {
      notLoaded: '未加载', idle: '空闲', systemError: '系统错误', active: '运行中',
    };
    const flags = active.threadStatus?.activeFlags || [];
    const status = flags.includes('waitingOnApproval')
      ? '等待批准'
      : flags.includes('waitingOnUserInput')
        ? '等待用户输入'
        : statusLabels[active.threadStatus?.type || ''] || (runningSessions.has(active.id) ? '运行中' : '空闲');
    const selectedModel = resolveModel(models, active.model, settings.model);
    const effort = resolveReasoningEffort(active.reasoningEffort, selectedModel);
    const tokenUsage = active.tokenUsage;
    const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
    const context = tokenUsage
      ? `${number(tokenUsage.last.totalTokens)}${tokenUsage.modelContextWindow ? ` / ${number(tokenUsage.modelContextWindow)}` : ''}`
      : '尚无用量数据';
    setDialog({
      title: '会话状态',
      details: [
        { label: '状态', value: status },
        { label: '线程 ID', value: active.threadId || '尚未创建' },
        { label: '项目', value: active.cwd || '未选择' },
        { label: '模型', value: selectedModel?.displayName || active.model || '默认' },
        { label: '推理强度', value: effortLabels[effort || ''] || effort || '默认' },
        { label: '协作模式', value: active.collaborationMode === 'plan' ? '计划模式' : '默认模式' },
        { label: '权限', value: permissionMode === 'yolo' ? 'YOLO 权限' : '默认权限' },
        { label: '当前上下文', value: context },
        { label: '累计 token', value: tokenUsage ? number(tokenUsage.total.totalTokens) : '尚无用量数据' },
      ],
      onConfirm: () => setDialog(undefined),
    });
  };

  const groups = useMemo(() => groupSessions(sessions, settings.projectPaths), [sessions, settings.projectPaths]);
  const running = !!active && runningSessions.has(active.id);
  const waiting = !!active && waitingSessions.has(active.id);
  const compacting = !!active && compactingSessions.has(active.id);
  const canRollback = !!active?.threadId && !running && !compacting
    && timelineOf(active).some(item => item.type === 'message' && item.role === 'user');
  return {
    active, addFiles, answerUserInput, archiveProject, archiveSession, attachments, canRollback, chooseFiles, choosePlanAction, clearContext, collapsedGroups, collaborationModes, compact, compacting, deleteProject, permissionMode, dialog, closeDialog: () => setDialog(undefined),
    closeSettings: () => setSettingsOpen(false), installation, openSettings, saveCodexPath, setFontSize, setTheme, settings, settingsOpen,
    createInFolder, createProjectSession, groups, input, models, moveProject, refreshHistory, removeAttachment: (id: string) => setAttachments(current => current.filter(attachment => attachment.id !== id)), running, runningSessions, selectedSkill, selectSkill, send, setActive, setHistoryRefreshIntervalSeconds, showStatus, skills,
    setCollaborationMode: (mode: 'default' | 'plan') => setActive(current => current ? { ...current, collaborationMode: mode } : current),
    setInput: updateInput, setModel, setPermissionMode,
    setReasoningEffort: (effort: string) => {
      setActive(current => current ? { ...current, reasoningEffort: effort } : current);
      window.codex.saveSettings({ reasoningEffort: effort }).then(setSettings).catch(() => undefined);
    },
    rollback, toggleGroup, waiting,
  };
}
