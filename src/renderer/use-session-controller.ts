import { useEffect, useMemo, useState } from 'react';
import { freshSession, groupSessions, normalizeSession, timelineOf } from './session-model';
import type { AppSettings, AttachmentKind, CodexAttachment, CodexInstallation, CodexModel, CodexSkill, CollaborationMode, Message, PermissionMode, PlanDecisionActivity, SaveCodexPathResult, Session, UserInputActivity } from './types';
import type { AppDialogState } from './components/AppDialog';

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
  const [skills, setSkills] = useState<CodexSkill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<CodexSkill>();
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>('default');
  const [dialog, setDialog] = useState<AppDialogState>();
  const [settings, setSettings] = useState<AppSettings>({ permissionMode: 'default' });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [installation, setInstallation] = useState<CodexInstallation>();

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
    setSessions(normalized);
    setActive(current => normalized.find(item => item.id === current?.id) || normalized[0]);
  };

  useEffect(() => {
    refreshHistory();
    window.codex.listModels().then(setModels).catch(() => setModels([]));
    window.codex.listCollaborationModes().then(setCollaborationModes).catch(() => setCollaborationModes([]));
    window.codex.getSettings().then(value => {
      setSettings(value);
      setPermissionModeState(value.permissionMode);
    }).catch(() => setPermissionModeState('default'));
    window.codex.getCodexInstallation().then(showMissingCodex).catch(() => undefined);
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
      window.codex.onStatus(value => {
        updateSession(value.sessionId, session => ({ ...session, threadStatus: value.status }));
        setWaitingSessions(current => {
          const next = new Set(current);
          if (value.status.type === 'active' && value.status.activeFlags?.includes('waitingOnUserInput')) next.add(value.sessionId);
          else next.delete(value.sessionId);
          return next;
        });
      }),
      window.codex.onTokenUsage(value => updateSession(value.sessionId, session => ({
        ...session,
        tokenUsage: value.tokenUsage,
      }))),
      window.codex.onUserInput(value => updateSession(value.sessionId, session => ({
        ...session,
        timeline: [...timelineOf(session), {
          id: value.request.itemId, type: 'user_input', status: 'pending', questions: value.request.questions,
        }],
        updated: Date.now(),
      }))),
      window.codex.onPlanReady(value => updateSession(value.sessionId, session => {
        const id = `plan-decision-${value.plan.itemId}`;
        if (timelineOf(session).some(item => item.id === id)) return session;
        return {
          ...session,
          timeline: [...timelineOf(session), {
            id, type: 'plan_decision', status: 'pending', plan: value.plan.text,
          }],
          updated: Date.now(),
        };
      })),
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

  const send = async () => {
    if ((!input.trim() && !attachments.length) || !active || runningSessions.has(active.id)) return;
    const text = input.trim();
    const skillPrefix = selectedSkill ? `$${selectedSkill.name}` : '';
    const prompt = selectedSkill && (text === skillPrefix || text.startsWith(`${skillPrefix} `))
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
    const selectedModel = models.find(model => model.isDefault) || models[0];
    const effectiveModel = active.model || selectedModel?.model;
    const effectiveEffort = active.reasoningEffort || selectedModel?.defaultReasoningEffort;
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
      ? `请在新的上下文中执行以下计划。\n\n${activity.plan}`
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
          timeline: [{ id: crypto.randomUUID(), type: 'message', role: 'user', text }],
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
    const selectedModel = models.find(model => model.isDefault) || models[0];
    const model = active.model || selectedModel?.model;
    const reasoningEffort = active.reasoningEffort || selectedModel?.defaultReasoningEffort;
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

  const createInFolder = (cwd: string) => setActive(freshSession(cwd));
  const createProjectSession = async () => { const cwd = await window.codex.chooseFolder(); if (cwd) createInFolder(cwd); };
  const addFiles = (filePaths: string[]) => {
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
    const selected = models.find(item => item.model === model);
    setActive(current => current ? { ...current, model, reasoningEffort: selected?.defaultReasoningEffort } : current);
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
    setSelectedSkill(current => current && (value === `$${current.name}` || value.startsWith(`$${current.name} `)) ? current : undefined);
  };
  const selectSkill = (skill: CodexSkill) => {
    setSelectedSkill(skill);
    setInput(`$${skill.name} `);
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
    const selectedModel = models.find(model => model.model === active.model)
      || models.find(model => model.isDefault)
      || models[0];
    const effort = active.reasoningEffort || selectedModel?.defaultReasoningEffort;
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

  const groups = useMemo(() => groupSessions(sessions), [sessions]);
  const running = !!active && runningSessions.has(active.id);
  const waiting = !!active && waitingSessions.has(active.id);
  const compacting = !!active && compactingSessions.has(active.id);
  return {
    active, addFiles, answerUserInput, archiveProject, archiveSession, attachments, chooseFiles, choosePlanAction, clearContext, collapsedGroups, collaborationModes, compact, compacting, permissionMode, dialog, closeDialog: () => setDialog(undefined),
    closeSettings: () => setSettingsOpen(false), installation, openSettings, saveCodexPath, settings, settingsOpen,
    createInFolder, createProjectSession, groups, input, models, refreshHistory, removeAttachment: (id: string) => setAttachments(current => current.filter(attachment => attachment.id !== id)), running, runningSessions, selectSkill, send, setActive, showStatus, skills,
    setCollaborationMode: (mode: 'default' | 'plan') => setActive(current => current ? { ...current, collaborationMode: mode } : current),
    setInput: updateInput, setModel, setPermissionMode,
    setReasoningEffort: (effort: string) => setActive(current => current ? { ...current, reasoningEffort: effort } : current),
    toggleGroup, waiting,
  };
}
