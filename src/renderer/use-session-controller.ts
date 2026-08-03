import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { freshSession, groupSessions, hasLoadedTimeline, normalizeSession, shouldKeepLiveTimeline, timelineOf, uniqueSessions } from './session-model';
import type { AppSettings, ArchiveResult, CodexAttachment, CodexInstallation, CodexModel, CodexProviderInput, CodexProviderState, CodexSkill, CollaborationMode, FontSize, PermissionMode, PlanDecisionActivity, PlanDecisionChoice, ProviderStateResult, SaveCodexPathResult, Session, ThemeMode, UserInputActivity } from './types';
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
  const [historyRevision, setHistoryRevision] = useState(0);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<CodexAttachment[]>([]);
  const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set());
  const [refreshingHistory, setRefreshingHistory] = useState(false);
  const [refreshingMessages, setRefreshingMessages] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [stoppingSessions, setStoppingSessions] = useState<Set<string>>(new Set());
  const [waitingSessions, setWaitingSessions] = useState<Set<string>>(new Set());
  const [compactingSessions, setCompactingSessions] = useState<Set<string>>(new Set());
  const [rollingBackSessions, setRollingBackSessions] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [models, setModels] = useState<CodexModel[]>([]);
  const [providerState, setProviderState] = useState<CodexProviderState>();
  const [collaborationModes, setCollaborationModes] = useState<CollaborationMode[]>([]);
  const [skills, setSkills] = useState<CodexSkill[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<CodexSkill>();
  const [permissionMode, setPermissionModeState] = useState<PermissionMode>('default');
  const [dialog, setDialog] = useState<AppDialogState>();
  const [settings, setSettings] = useState<AppSettings>({ permissionMode: 'default', fontSize: 'small', theme: initialTheme });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archivedSessions, setArchivedSessions] = useState<Session[]>([]);
  const projectFilesCache = useRef<Map<string, { files?: string[]; loadedAt: number; pending?: Promise<string[]> }>>(new Map());
  const [installation, setInstallation] = useState<CodexInstallation>();
  const settingsRef = useRef(settings);
  const runningSessionsRef = useRef(runningSessions);
  const refreshingHistoryRef = useRef(false);
  const rollingBackSessionsRef = useRef<Set<string>>(new Set());
  const sendingSessionsRef = useRef<Set<string>>(new Set());
  const sessionReadEpochsRef = useRef<Map<string, number>>(new Map());
  const planChoicesInFlight = useRef<Set<string>>(new Set());
  const sessionTitlesRef = useRef<Record<string, string>>({});
  const archivingSessionsRef = useRef<Set<string>>(new Set());
  const historyMutationRevisionRef = useRef(0);
  const archivedThreadIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!providerState) return;
    setSettings(current => ({
      ...current,
      ...(providerState.model ? { model: providerState.model } : {}),
    }));
  }, [providerState]);

  useEffect(() => {
    runningSessionsRef.current = runningSessions;
    setStoppingSessions(current => {
      const next = new Set([...current].filter(sessionId => runningSessions.has(sessionId)));
      return next.size === current.size ? current : next;
    });
  }, [runningSessions]);

  const markSessionRunning = (sessionId: string) => {
    // app-server can emit cli:thread before React commits setRunningSessions.
    // Update the ref first so the first history read cannot replace the live
    // timeline with a not-yet-persisted empty turn list.
    runningSessionsRef.current = new Set(runningSessionsRef.current).add(sessionId);
    setRunningSessions(current => current.has(sessionId) ? current : new Set(current).add(sessionId));
  };

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
    window.codex.getProviders().then(setProviderState).catch(() => undefined);
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

  const withLocalTitle = (session: Session): Session => {
    const title = session.threadId ? sessionTitlesRef.current[session.threadId] : undefined;
    return title ? { ...session, title } : session;
  };

  const latestTokenUsage = (current?: Session['tokenUsage'], incoming?: Session['tokenUsage']) => {
    if (!current) return incoming;
    if (!incoming) return current;
    return (incoming.reportedAt || 0) >= (current.reportedAt || 0) ? incoming : current;
  };
  const tokenUsagePending = (current: Session, incoming: Session) =>
    incoming.tokenUsage ? false : current.tokenUsagePending;

  const planDecisionKey = (session: Session, activityId: string) => `${session.threadId || session.id}:${activityId}`;
  const applyPlanDecisionChoices = (session: Session): Session => {
    const choices = settingsRef.current.planDecisionChoices;
    if (!choices) return session;
    let changed = false;
    const timeline = timelineOf(session).map(item => {
      if (item.type !== 'plan_decision' || item.status === 'answered') return item;
      const choice = choices[planDecisionKey(session, item.id)];
      if (!choice) return item;
      changed = true;
      return { ...item, status: 'answered' as const, choice };
    });
    return changed ? { ...session, timeline } : session;
  };
  const savePlanDecisionChoice = (session: Session, activityId: string, choice: PlanDecisionChoice) => {
    const planDecisionChoices = { ...settingsRef.current.planDecisionChoices, [planDecisionKey(session, activityId)]: choice };
    const next = { ...settingsRef.current, planDecisionChoices };
    settingsRef.current = next;
    setSettings(next);
    void window.codex.saveSettings({ planDecisionChoices }).then(saved => {
      settingsRef.current = saved;
      setSettings(saved);
    }).catch(() => undefined);
  };

  const refreshHistory = async () => {
    const requestRevision = historyMutationRevisionRef.current;
    let items: Session[];
    try {
      items = await window.codex.loadHistory();
      if (items?.length === 0) {
        await new Promise<void>(resolve => window.setTimeout(resolve, 120));
        const retry = await window.codex.loadHistory();
        if (retry?.length) items = retry;
      }
    } catch {
      setHistoryError('无法确认当前提供商的会话列表，请刷新后重试。');
      return;
    }
    if (!items) {
      setHistoryError('无法确认当前提供商的会话列表，请刷新后重试。');
      return;
    }
    if (requestRevision !== historyMutationRevisionRef.current) return;
    setHistoryError(undefined);
    const normalized = uniqueSessions(
      items
        .map(normalizeSession)
        .map(withLocalTitle)
        .map(applyPlanDecisionChoices)
        .filter(session => !session.threadId || !archivedThreadIdsRef.current.has(session.threadId)),
    );
    rememberProjects(normalized.map(item => item.cwd));
    setSessions(current => {
      const liveById = new Map(current.map(session => [session.id, session]));
      const liveByThread = new Map(
        current
          .filter(session => session.threadId)
          .map(session => [session.threadId as string, session]),
      );
      const merged = normalized.map(session => {
        const live = liveById.get(session.id)
          || (session.threadId ? liveByThread.get(session.threadId) : undefined);
        if (!live) return session;
        // The sidebar refresh is backed by thread/list, whose records omit
        // turns. Preserve a transcript previously returned by thread/read.
        if (!hasLoadedTimeline(session) && hasLoadedTimeline(live)) {
          return {
            ...session,
            id: live.id,
            timeline: live.timeline,
            messages: live.messages,
            model: live.model || session.model,
            reasoningEffort: live.reasoningEffort || session.reasoningEffort,
            collaborationMode: live.collaborationMode || session.collaborationMode,
            tokenUsage: latestTokenUsage(live.tokenUsage, session.tokenUsage),
            tokenUsagePending: tokenUsagePending(live, session),
          };
        }
        if (!runningSessionsRef.current.has(live.id)) {
          return {
            ...session,
            id: live.id,
            model: live.model || session.model,
            reasoningEffort: live.reasoningEffort || session.reasoningEffort,
            collaborationMode: live.collaborationMode || session.collaborationMode,
          };
        }
        // A running turn can have newer streamed items than thread/read; use the
        // server's event stream only until its completed snapshot is available.
        return {
          ...session,
          id: live.id,
          timeline: timelineOf(live),
          messages: undefined,
          model: live.model || session.model,
          reasoningEffort: live.reasoningEffort || session.reasoningEffort,
          collaborationMode: live.collaborationMode || session.collaborationMode,
          tokenUsage: latestTokenUsage(live.tokenUsage, session.tokenUsage),
          tokenUsagePending: tokenUsagePending(live, session),
          updated: live.updated,
        };
      });
      const knownThreadIds = new Set(normalized.map(session => session.threadId).filter(Boolean));
      const liveOnly = current.filter(session => !session.threadId || (runningSessionsRef.current.has(session.id) && !knownThreadIds.has(session.threadId)));
      return uniqueSessions([...liveOnly, ...merged]);
    });
    setActive(current => {
      if (!current) return normalized[0];
      const fromHistory = normalized.find(item => item.id === current.id)
        || (current.threadId ? normalized.find(item => item.threadId === current.threadId) : undefined);
      if (!fromHistory) return (!current.threadId || runningSessionsRef.current.has(current.id)) ? current : normalized[0];
      if (!hasLoadedTimeline(fromHistory) && hasLoadedTimeline(current)) {
        return {
          ...fromHistory,
          id: current.id,
          timeline: current.timeline,
          messages: current.messages,
          model: current.model || fromHistory.model,
          reasoningEffort: current.reasoningEffort || fromHistory.reasoningEffort,
          collaborationMode: current.collaborationMode || fromHistory.collaborationMode,
          tokenUsage: latestTokenUsage(current.tokenUsage, fromHistory.tokenUsage),
          tokenUsagePending: tokenUsagePending(current, fromHistory),
        };
      }
      if (!runningSessionsRef.current.has(current.id)) {
        return {
          ...fromHistory,
          id: current.id,
          model: current.model || fromHistory.model,
          reasoningEffort: current.reasoningEffort || fromHistory.reasoningEffort,
          collaborationMode: current.collaborationMode || fromHistory.collaborationMode,
        };
      }
      return {
        ...fromHistory,
        id: current.id,
        timeline: timelineOf(current),
        messages: undefined,
        model: current.model || fromHistory.model,
        reasoningEffort: current.reasoningEffort || fromHistory.reasoningEffort,
        collaborationMode: current.collaborationMode || fromHistory.collaborationMode,
        tokenUsage: latestTokenUsage(current.tokenUsage, fromHistory.tokenUsage),
        tokenUsagePending: tokenUsagePending(current, fromHistory),
        updated: current.updated,
      };
    });
    setHistoryRevision(current => current + 1);
  };

  const refreshHistoryWithStatus = async () => {
    if (refreshingHistoryRef.current) return;
    refreshingHistoryRef.current = true;
    setRefreshingHistory(true);
    setRefreshingMessages(true);
    try {
      // Let the opacity transition render before the history request can finish.
      await new Promise<void>(resolve => window.setTimeout(resolve, 180));
      await refreshHistory();
      await new Promise<void>(resolve => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
      });
    } finally {
      setRefreshingMessages(false);
      refreshingHistoryRef.current = false;
      setRefreshingHistory(false);
    }
  };

  useSessionEvents({
    refreshHistory,
    refreshHistoryWithStatus,
    showMissingCodex,
    setActive,
    setCollaborationModes,
    setCompactingSessions,
    setModels,
    setPermissionMode: setPermissionModeState,
    setProviderState,
    setRunningSessions,
    setSessions,
    setSettings,
    setWaitingSessions,
  });

  useEffect(() => {
    if (!active) return;
    setSessions(items => uniqueSessions([active, ...items]));
  }, [active]);

  useEffect(() => {
    if (!settings.planDecisionChoices) return;
    setSessions(current => current.map(applyPlanDecisionChoices));
    setActive(current => current ? applyPlanDecisionChoices(current) : current);
  }, [settings.planDecisionChoices]);

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

  const attachmentContext = (items: CodexAttachment[]) => {
    const paths = items
      .map(item => item.path.trim())
      .filter(Boolean);
    return paths.length
      ? `\n\nThe following local files are part of this request.\n\nRead and use them as context before producing any response.\n\nFiles:\n${paths.map(path => `- ${path.replace(/[\r\n]/g, '\\n')}`).join('\n')}`
      : '';
  };

  const send = async (message = input) => {
    if ((!message.trim() && !attachments.length) || !active || runningSessions.has(active.id) || sendingSessionsRef.current.has(active.id)) return;
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
    sendingSessionsRef.current.add(active.id);
    const messageId = crypto.randomUUID();
    const displayedText = `${text}${attachmentContext(sentAttachments)}`.trim();
    setActive(current => current?.id === active.id ? {
      ...current,
      timeline: [...timelineOf(current), { id: messageId, type: 'message', role: 'user', text: displayedText, attachments: sentAttachments }],
      title: current.title === '新建对话' ? (text || sentAttachments[0]?.name || '附件').slice(0, 32) : current.title,
      tokenUsagePending: true,
    } : current);
    markSessionRunning(active.id);
    const preferredModel = providerState?.model || settings.model;
    const preferredEffort = settings.reasoningEffort || providerState?.reasoningEffort;
    const selectedModel = resolveModel(models, active.model, preferredModel);
    const effectiveModel = active.model || preferredModel || selectedModel?.model;
    const effectiveEffort = resolveReasoningEffort(preferredEffort, selectedModel);
    let started = false;
    try {
      started = await window.codex.start({
        sessionId: active.id, cwd: active.cwd, prompt, attachments: sentAttachments, skill: sentSkill, threadId: active.threadId,
        model: effectiveModel, reasoningEffort: effectiveEffort,
        collaborationMode: collaborationModes.find(mode => mode.mode === (active.collaborationMode || 'default')),
        permissionMode,
      });
      if (started) return;
      setActive(current => current?.id === active.id ? {
        ...current,
        timeline: timelineOf(current).filter(item => item.id !== messageId),
      } : current);
      setInput(current => current || message);
      setAttachments(current => current.length ? current : sentAttachments);
    } catch (error) {
      setActive(current => current?.id === active.id ? {
        ...current,
        timeline: [
          ...timelineOf(current).filter(item => item.id !== messageId),
          { id: crypto.randomUUID(), type: 'message', role: 'error', text: error instanceof Error ? error.message : String(error) },
        ],
      } : current);
      setInput(current => current || message);
      setAttachments(current => current.length ? current : sentAttachments);
    } finally {
      sendingSessionsRef.current.delete(active.id);
      if (!started) setRunningSessions(current => without(current, active.id));
    }
  };

  const compact = async () => {
    if (!active?.threadId || runningSessions.has(active.id) || compactingSessions.has(active.id) || rollingBackSessionsRef.current.has(active.id)) return;
    setCompactingSessions(current => new Set(current).add(active.id));
    try {
      if (!await window.codex.compact(active.id, active.threadId)) throw new Error('无法开始压缩。');
    } catch (error) {
      setCompactingSessions(current => without(current, active.id));
      appendLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  const rollback = async () => {
    if (!active?.threadId || runningSessions.has(active.id) || compactingSessions.has(active.id) || rollingBackSessionsRef.current.has(active.id)) return;
    const threadId = active.threadId;
    const target = active;
    rollingBackSessionsRef.current.add(target.id);
    setRollingBackSessions(current => new Set(current).add(target.id));
    const targetMessages = timelineOf(target)
      .filter((item): item is { id: string; type: 'message'; role: 'user'; text: string; attachments?: CodexAttachment[] } => item.type === 'message' && item.role === 'user');
    sessionReadEpochsRef.current.set(threadId, (sessionReadEpochsRef.current.get(threadId) || 0) + 1);
    try {
      const rolledBack = await window.codex.rollback(target.id, threadId);
      if (!rolledBack) throw new Error('无法撤销最近一轮对话。');
      const restoredMessages = timelineOf(rolledBack)
        .filter((item): item is { id: string; type: 'message'; role: 'user'; text: string } => item.type === 'message' && item.role === 'user');
      // thread/rollback removes its final user turn. Compare turn counts rather
      // than text because App Server may expand attachment context in history.
      const restoredMessage = targetMessages.length === restoredMessages.length + 1
        ? targetMessages[targetMessages.length - 1]
        : undefined;
      if (restoredMessage) {
        const restoredAttachments = restoredMessage.attachments || [];
        const generatedAttachmentContext = attachmentContext(restoredAttachments).trim();
        const restoredText = generatedAttachmentContext && restoredMessage.text.endsWith(generatedAttachmentContext)
          ? restoredMessage.text.slice(0, -generatedAttachmentContext.length).trimEnd()
          : restoredMessage.text;
        setInput(restoredText);
        setAttachments(restoredAttachments);
      }
      setActive(current => current?.id === target.id ? {
        ...rolledBack,
        id: current.id,
        title: current.title || rolledBack.title,
        model: current.model || rolledBack.model,
        reasoningEffort: current.reasoningEffort || rolledBack.reasoningEffort,
        collaborationMode: current.collaborationMode || rolledBack.collaborationMode,
        tokenUsage: rolledBack.tokenUsage || current.tokenUsage,
        tokenUsagePending: !rolledBack.tokenUsage,
      } : current);
    } catch (error) {
      setDialog({
        title: '撤销失败',
        description: error instanceof Error ? error.message : String(error),
        onConfirm: () => setDialog(undefined),
      });
    } finally {
      rollingBackSessionsRef.current.delete(target.id);
      setRollingBackSessions(current => without(current, target.id));
    }
  };

  const selectSession = (session: Session) => setActive(session);

  useEffect(() => {
    if (!active?.threadId || runningSessionsRef.current.has(active.id)) return;
    const sessionId = active.id;
    const threadId = active.threadId;
    let current = true;
    const epoch = sessionReadEpochsRef.current.get(threadId) || 0;
    window.codex.loadSession(threadId).then(loaded => {
      if (!current || !loaded || (sessionReadEpochsRef.current.get(threadId) || 0) !== epoch) return;
      const next = applyPlanDecisionChoices(withLocalTitle(normalizeSession(loaded)));
      const mergeLoadedSession = (live: Session) => {
        const keepLiveTimeline = shouldKeepLiveTimeline(timelineOf(live), timelineOf(next), {
          liveUpdated: live.updated,
          incomingUpdated: next.updated,
        });
        return {
          ...next,
          id: live.id,
          title: live.title || next.title,
          model: live.model || next.model,
          reasoningEffort: live.reasoningEffort || next.reasoningEffort,
          collaborationMode: live.collaborationMode || next.collaborationMode,
          tokenUsage: latestTokenUsage(live.tokenUsage, next.tokenUsage),
          tokenUsagePending: tokenUsagePending(live, next),
          ...(keepLiveTimeline ? { timeline: timelineOf(live), messages: undefined } : {}),
        };
      };
      setSessions(items => items.map(item => item.id === sessionId || item.threadId === threadId ? mergeLoadedSession(item) : item));
      setActive(selected => {
        if (!selected || (selected.id !== sessionId && selected.threadId !== threadId)) return selected;
        return mergeLoadedSession(selected);
      });
    }).catch(() => {
      // Keep the list metadata visible when an individual history read fails.
    });
    return () => { current = false; };
  }, [active?.id, active?.threadId, historyRevision]);

  useEffect(() => {
    let current = true;
    window.codex.loadSessionTitles().then(titles => {
      if (!current) return;
      sessionTitlesRef.current = titles;
      void refreshHistory();
    }).catch(() => undefined);
    return () => { current = false; };
  }, []);

  const stop = async () => {
    if (!active || !runningSessions.has(active.id) || stoppingSessions.has(active.id)) return;
    setStoppingSessions(current => new Set(current).add(active.id));
    try {
      if (!await window.codex.stop(active.id)) throw new Error('当前会话没有可停止的任务。');
    } catch (error) {
      setStoppingSessions(current => without(current, active.id));
      setDialog({
        title: '停止失败',
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
    if (!active || runningSessions.has(active.id) || planChoicesInFlight.current.has(activity.id)) return;
    planChoicesInFlight.current.add(activity.id);
    const answeredTimeline = timelineOf(active).map(item => item.id === activity.id
      ? { ...activity, status: 'answered' as const, choice }
      : item);
    if (choice === 'stay') {
      savePlanDecisionChoice(active, activity.id, choice);
      setActive({ ...active, timeline: answeredTimeline, collaborationMode: 'plan', updated: Date.now() });
      return;
    }

    const fresh = choice === 'fresh';
    const text = fresh
      ? 'Start a new execution context and implement the confirmed plan below.\n\nThis conversation intentionally starts without previous context.\nThe confirmed plan contains all required information.\n\nExecution Rules:\n- Treat the plan as the single source of truth.\n- Do not regenerate or redesign the plan.\n- Do not ask the user to restate previous discussions.\n- Begin implementation immediately.\n- Continue until the work is complete or required information is missing.\n\nConfirmed Plan:'
      : 'Execute the confirmed plan below.\n\nThe plan has already been reviewed and approved.\n\nExecution Rules:\n- Follow the plan as written.\n- Do not generate a new plan.\n- Do not ask the user to restate the objective.\n- Do not repeat planning or analysis already completed.\n- Begin implementation immediately.\n- Continue until the work is finished or user intervention is required.\n\nConfirmed Plan:';
    // Plan items are surfaced separately by app-server and are not guaranteed
    // to be included in the next turn's conversational context. Send the
    // authoritative plan returned for this decision with either action.
    const prompt = `${text}\n\n${activity.plan}`;
    if (!active.cwd) {
      planChoicesInFlight.current.delete(activity.id);
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
          timeline: [...answeredTimeline, { id: crypto.randomUUID(), type: 'message', role: 'user', text: prompt }],
        };
    if (fresh) {
      setSessions(current => current.map(session => session.id === active.id ? answeredSession : session));
    }
    setActive(nextSession);
    markSessionRunning(nextSession.id);
    const preferredModel = providerState?.model || settings.model;
    const preferredEffort = settings.reasoningEffort || providerState?.reasoningEffort;
    const selectedModel = resolveModel(models, active.model, preferredModel);
    const model = active.model || preferredModel || selectedModel?.model;
    const reasoningEffort = resolveReasoningEffort(preferredEffort, selectedModel);
    try {
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
      if (!started) throw new Error('无法开始执行计划。');
      savePlanDecisionChoice(active, activity.id, choice);
    } catch (error) {
      setRunningSessions(current => without(current, nextSession.id));
      if (fresh) setSessions(current => current.map(session => session.id === active.id ? active : session));
      setActive({
        ...active,
        timeline: [...timelineOf(active), {
          id: crypto.randomUUID(), type: 'message', role: 'error',
          text: error instanceof Error ? error.message : String(error),
        }],
      });
    } finally {
      planChoicesInFlight.current.delete(activity.id);
    }
  };

  const createInFolder = (cwd: string) => {
    rememberProjects([cwd]);
    setActive({
      ...freshSession(cwd),
      ...(providerState?.model || settings.model ? { model: providerState?.model || settings.model } : {}),
      ...(settings.reasoningEffort || providerState?.reasoningEffort ? { reasoningEffort: settings.reasoningEffort || providerState?.reasoningEffort } : {}),
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
  const archiveSession = async (target = active) => {
    if (!target || runningSessions.has(target.id)) return;
    await performArchiveSession(target);
  };
  const performArchiveSession = async (target: Session) => {
    if (!target.threadId) {
      const remaining = sessions.filter(session => session.id !== target.id);
      setSessions(remaining);
      setActive(current => current?.id === target.id ? remaining[0] : current);
      return;
    }
    const archiveKey = target.threadId;
    if (archivingSessionsRef.current.has(archiveKey)) return;
    archivingSessionsRef.current.add(archiveKey);
    try {
      const archived = await window.codex.archiveSession(target);
      if (!archived.ok) {
        setDialog({ title: '归档失败', description: archived.error || '未知错误', onConfirm: () => setDialog(undefined) });
        return;
      }
      historyMutationRevisionRef.current += 1;
      archivedThreadIdsRef.current.add(archiveKey);
      const remaining = sessions.filter(session => session.id !== target.id && (!target.threadId || session.threadId !== target.threadId));
      setSessions(current => current.filter(session => session.id !== target.id && (!target.threadId || session.threadId !== target.threadId)));
      setActive(current => current && (current.id === target.id || (target.threadId && current.threadId === target.threadId)) ? remaining[0] : current);
    } finally {
      archivingSessionsRef.current.delete(archiveKey);
    }
  };
  const archiveProject = async (cwd: string, projectSessions: Session[]) => {
    if (projectSessions.some(session => runningSessions.has(session.id))) return;
    await performArchiveProject(projectSessions);
  };
  const renameSession = async (target: Session, title: string) => {
    if (!target.threadId) return;
    try {
      const titles = await window.codex.saveSessionTitle(target.threadId, title);
      sessionTitlesRef.current = titles;
      setSessions(current => current.map(session => session.threadId === target.threadId ? { ...session, title } : session));
      setActive(current => {
        if (!current || current.threadId !== target.threadId) return current;
        return { ...current, title };
      });
    } catch (error) {
      setDialog({
        title: '重命名失败',
        description: error instanceof Error ? error.message : String(error),
        onConfirm: () => setDialog(undefined),
      });
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
          const succeededThreadIds = new Set(result.succeededThreadIds || []);
          if (succeededThreadIds.size) {
            setSessions(current => current.filter(session => !session.threadId || !succeededThreadIds.has(session.threadId)));
            setActive(current => current?.threadId && succeededThreadIds.has(current.threadId) ? undefined : current);
          }
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
    const persistedSessions = projectSessions.filter(session => session.threadId);
    const archived: ArchiveResult = persistedSessions.length
      ? await window.codex.archiveProject(persistedSessions)
      : { ok: true, succeededThreadIds: [] };
    const succeededThreadIds = new Set(archived.succeededThreadIds || []);
    if (succeededThreadIds.size) {
      historyMutationRevisionRef.current += 1;
      succeededThreadIds.forEach(threadId => archivedThreadIdsRef.current.add(threadId));
      setSessions(current => current.filter(session => !session.threadId || !succeededThreadIds.has(session.threadId)));
      setActive(current => current?.threadId && succeededThreadIds.has(current.threadId) ? undefined : current);
    }
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
      setArchivedSessions((await window.codex.listArchivedSessions()).map(withLocalTitle));
    } catch {
      setArchivedSessions([]);
    }
  };

  const refreshArchivedSessions = async () => {
    try {
      setArchivedSessions((await window.codex.listArchivedSessions()).map(withLocalTitle));
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
    if (target.threadId) {
      historyMutationRevisionRef.current += 1;
      archivedThreadIdsRef.current.delete(target.threadId);
    }
    const restored = withLocalTitle(normalizeSession(result.session));
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
          const succeededThreadIds = new Set(result.succeededThreadIds || []);
          setArchivedSessions(current => current.filter(session => !session.threadId || !succeededThreadIds.has(session.threadId)));
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

  const loadDiff = async (activityId: string, file: import('./types').FileChange) => {
    if (!active?.cwd) return;
    const sessionId = active.id;
    const cwd = active.cwd;
    const loaded = await window.codex.loadDiff(cwd, file);
    if (!loaded) return;
    const update = (session: Session) => ({
      ...session,
      timeline: timelineOf(session).map(item => item.type === 'file_change' && item.id === activityId
        ? { ...item, files: item.files.map(current => current.path === file.path ? loaded : current) }
        : item),
    });
    setActive(current => current?.id === sessionId ? update(current) : current);
    setSessions(current => current.map(session => session.id === sessionId ? update(session) : session));
  };

  const openProjectDirectory = async () => {
    const result = await window.codex.openProjectDirectory(active?.cwd);
    if (!result.ok) {
      setDialog({ title: '无法打开项目目录', description: result.error || '未知错误', onConfirm: () => setDialog(undefined) });
    }
  };

  const openTerminal = async () => {
    const result = await window.codex.openTerminal(active?.cwd);
    if (!result.ok) {
      setDialog({ title: '无法打开 Windows Terminal', description: result.error || '未知错误', onConfirm: () => setDialog(undefined) });
    }
  };

  const listMentionFiles = useCallback(async (cwd: string, query: string) => {
    if (!cwd) return [] as string[];
    const cached = projectFilesCache.current.get(cwd);
    let files = cached?.files;
    if (!files || !cached || Date.now() - cached.loadedAt > 60_000) {
      const pending = cached?.pending || window.codex.listProjectFiles(cwd);
      projectFilesCache.current.set(cwd, { ...cached, loadedAt: cached?.loadedAt || 0, pending });
      try {
        files = await pending;
        projectFilesCache.current.set(cwd, { files, loadedAt: Date.now() });
      } catch (error) {
        projectFilesCache.current.delete(cwd);
        throw error;
      }
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
  }, []);
  const toggleGroup = (cwd: string) => setCollapsedGroups(current => {
    const next = new Set(current); if (next.has(cwd)) next.delete(cwd); else next.add(cwd); return next;
  });
  const setModel = (model: string) => {
    const selected = resolveModel(models, model);
    const currentEffort = settingsRef.current.reasoningEffort || providerState?.reasoningEffort || active?.reasoningEffort;
    const reasoningEffort = resolveReasoningEffort(currentEffort, selected);
    setActive(current => current ? {
      ...current,
      model,
      reasoningEffort: reasoningEffort || current.reasoningEffort,
      tokenUsagePending: true,
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
  const updateProviderState = (next: CodexProviderState) => {
    setProviderState(next);
    setSettings(current => ({
      ...current,
      ...(next.model ? { model: next.model } : {}),
      ...(next.reasoningEffort ? { reasoningEffort: next.reasoningEffort } : {}),
    }));
  };
  const loadProviders = async () => {
    const next = await window.codex.getProviders();
    updateProviderState(next);
    return next;
  };
  const saveProvider = async (provider: CodexProviderInput): Promise<ProviderStateResult> => {
    const result = await window.codex.saveProvider(provider);
    if (!result.ok) return result;
    updateProviderState(result.state);
    const savedId = provider.id || result.state.providers.find(item => item.name === provider.name.trim())?.id;
    if (savedId) {
      const activated = await window.codex.activateProvider(savedId);
      if (!activated.ok) return activated;
      updateProviderState(activated.state);
      await refreshHistory();
      return activated;
    }
    return result;
  };
  const activateProvider = async (id: string): Promise<ProviderStateResult> => {
    const result = await window.codex.activateProvider(id);
    if (result.ok) {
      updateProviderState(result.state);
      await refreshHistory();
    }
    return result;
  };
  const deleteProvider = async (id: string): Promise<ProviderStateResult> => {
    const result = await window.codex.deleteProvider(id);
    if (result.ok) updateProviderState(result.state);
    return result;
  };
  const updateInput = (value: string) => {
    setInput(value);
    setSelectedSkill(current => current && (value === `/${current.name}` || value.startsWith(`/${current.name} `)) ? current : undefined);
  };

  const selectSkill = (skill: CodexSkill) => {
    setSelectedSkill(skill);
    setInput(`/${skill.name}`);
  };

  const showStatus = () => {
    if (!active) return;
    setDialog(createSessionStatusDialog({
      session: active,
      models,
      preferredModel: providerState?.model || settings.model,
      preferredReasoningEffort: settings.reasoningEffort || providerState?.reasoningEffort,
      permissionMode,
      running: runningSessions.has(active.id),
      onClose: () => setDialog(undefined),
    }));
  };

  const groups = useMemo(() => groupSessions(sessions, settings.projectPaths), [sessions, settings.projectPaths]);
  const running = !!active && runningSessions.has(active.id);
  const waiting = !!active && waitingSessions.has(active.id);
  const compacting = !!active && compactingSessions.has(active.id);
  const rollingBack = !!active && rollingBackSessions.has(active.id);
  const canRollback = !!active?.threadId && !running && !compacting && !rollingBack
    && timelineOf(active).some(item => item.type === 'message' && item.role === 'user');
  return {
    active, addFiles, answerUserInput, archiveOpen, archiveProject, archiveSession, archivedSessions, attachments, canRollback, chooseFiles, choosePlanAction, collapsedGroups, collaborationModes, compact, compacting, deleteProject, permissionMode, dialog, closeDialog: () => setDialog(undefined),
    clearArchivedSessions, closeArchive: () => setArchiveOpen(false), closeSettings: () => setSettingsOpen(false), installation, listMentionFiles, loadDiff, loadProviders, openArchive, openInVsCode, openPath, openProjectDirectory, openSettings, openTerminal, providerState, refreshArchivedSessions, removeArchivedSession, restoreArchivedSession, saveCodexPath, saveProvider, activateProvider, deleteProvider, setFontSize, setTheme, settings, settingsOpen,
    createInFolder, createProjectSession, groups, historyError, input, models, moveProject, refreshHistory: refreshHistoryWithStatus, refreshingHistory, refreshingMessages, removeAttachment: (id: string) => setAttachments(current => current.filter(attachment => attachment.id !== id)), renameSession, running, runningSessions, selectedSkill, selectSkill, send, setActive: selectSession, showStatus, skills, stop, stopping: !!active && stoppingSessions.has(active.id),
    setCollaborationMode: (mode: 'default' | 'plan') => setActive(current => current ? { ...current, collaborationMode: mode } : current),
    setInput: updateInput, setModel, setPermissionMode,
    setReasoningEffort: (effort: string) => {
      const nextSettings = { ...settingsRef.current, reasoningEffort: effort };
      settingsRef.current = nextSettings;
      setSettings(nextSettings);
      setActive(current => current ? { ...current, reasoningEffort: effort } : current);
      window.codex.saveSettings({ reasoningEffort: effort }).then(saved => {
        settingsRef.current = saved;
        setSettings(saved);
      }).catch(() => undefined);
    },
    rollback, rollingBack, toggleGroup, waiting,
  };
}


