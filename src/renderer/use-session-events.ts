import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { normalizeSession, timelineOf } from './session-model';
import { without } from './session-set-utils';
import type { AppSettings, CodexInstallation, CodexModel, CollaborationMode, Message, PermissionMode, Session } from './types';

type Options = {
  historyRefreshIntervalSeconds: number;
  refreshHistory(): Promise<void>;
  showMissingCodex(installation: CodexInstallation): void;
  setActive: Dispatch<SetStateAction<Session | undefined>>;
  setCollaborationModes: Dispatch<SetStateAction<CollaborationMode[]>>;
  setCompactingSessions: Dispatch<SetStateAction<Set<string>>>;
  setModels: Dispatch<SetStateAction<CodexModel[]>>;
  setPermissionMode: Dispatch<SetStateAction<PermissionMode>>;
  setRunningSessions: Dispatch<SetStateAction<Set<string>>>;
  setSessions: Dispatch<SetStateAction<Session[]>>;
  setSettings: Dispatch<SetStateAction<AppSettings>>;
  setWaitingSessions: Dispatch<SetStateAction<Set<string>>>;
};

export function useSessionEvents(options: Options) {
  useEffect(() => {
    options.refreshHistory();
    window.codex.listModels().then(options.setModels).catch(() => options.setModels([]));
    window.codex.listCollaborationModes().then(options.setCollaborationModes).catch(() => options.setCollaborationModes([]));
    window.codex.getSettings().then(value => {
      options.setSettings(value);
      options.setPermissionMode(value.permissionMode);
    }).catch(() => options.setPermissionMode('default'));
    window.codex.getCodexInstallation().then(options.showMissingCodex).catch(() => undefined);
    const refreshInterval = window.setInterval(options.refreshHistory, options.historyRefreshIntervalSeconds * 1_000);

    const updateSession = (sessionId: string, update: (session: Session) => Session) => {
      let nextSession: Session | undefined;
      options.setActive(current => {
        if (current?.id !== sessionId) return current;
        nextSession = update(normalizeSession(current));
        return nextSession;
      });
      options.setSessions(items => {
        let changed = false;
        const nextItems = items.map(session => {
          if (session.id !== sessionId) return session;
          const next = nextSession || update(normalizeSession(session));
          nextSession = next;
          changed = true;
          return next;
        });
        return changed ? nextItems : items;
      });
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
      window.codex.onActivity(value => {
        if (value.activity.type === 'compaction' && value.activity.status === 'completed') {
          options.setCompactingSessions(current => without(current, value.sessionId));
        }
        updateSession(value.sessionId, session => {
          const timeline = [...timelineOf(session)];
          const index = timeline.findIndex(item => item.id === value.activity.id);
          if (index >= 0) timeline[index] = { ...timeline[index], ...value.activity } as typeof value.activity;
          else timeline.push(value.activity);
          return { ...session, timeline, updated: Date.now() };
        });
      }),
      window.codex.onThread(value => updateSession(value.sessionId, session => ({ ...session, threadId: value.threadId }))),
      window.codex.onExit(value => options.setRunningSessions(current => without(current, value.sessionId))),
      window.codex.onError(value => {
        options.setRunningSessions(current => without(current, value.sessionId));
        options.setCompactingSessions(current => without(current, value.sessionId));
        appendMessage(value.sessionId, { role: 'error', text: value.error });
      }),
      window.codex.onCompacted(value => options.setCompactingSessions(current => without(current, value.sessionId))),
      window.codex.onStatus(value => {
        updateSession(value.sessionId, session => ({ ...session, threadStatus: value.status }));
        options.setWaitingSessions(current => {
          const next = new Set(current);
          if (value.status.type === 'active' && value.status.activeFlags?.includes('waitingOnUserInput')) next.add(value.sessionId);
          else next.delete(value.sessionId);
          return next;
        });
      }),
      window.codex.onTokenUsage(value => updateSession(value.sessionId, session => ({ ...session, tokenUsage: value.tokenUsage }))),
      window.codex.onUserInput(value => updateSession(value.sessionId, session => ({
        ...session,
        timeline: [...timelineOf(session), { id: value.request.itemId, type: 'user_input', status: 'pending', questions: value.request.questions }],
        updated: Date.now(),
      }))),
      window.codex.onPlanReady(value => updateSession(value.sessionId, session => {
        const id = `plan-decision-${value.plan.itemId}`;
        if (timelineOf(session).some(item => item.id === id)) return session;
        return { ...session, timeline: [...timelineOf(session), { id, type: 'plan_decision', status: 'pending', plan: value.plan.text }], updated: Date.now() };
      })),
    ];
    return () => {
      window.clearInterval(refreshInterval);
      unsubscribe.forEach(removeListener => removeListener());
    };
  }, [options.historyRefreshIntervalSeconds]);
}
