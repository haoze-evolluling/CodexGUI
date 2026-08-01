import type { Message, Session, SessionGroup, TimelineItem } from './types';

const messageItem = (message: Message, index: number): TimelineItem => ({
  id: `legacy-message-${index}`,
  type: 'message',
  ...message,
});

export const timelineOf = (session: Session): TimelineItem[] =>
  Array.isArray(session.timeline)
    ? session.timeline
    : (session.messages || []).map(messageItem);

// An omitted transcript means that thread/list returned metadata only. It is
// different from an explicitly empty timeline returned by thread/read.
export const hasLoadedTimeline = (session: Session): boolean =>
  Array.isArray(session.timeline) || Array.isArray(session.messages);

export const activityCount = (items: TimelineItem[] = []) =>
  items.filter(item => item.type !== 'message').length;

const commandCount = (items: TimelineItem[] = []) =>
  items.filter(item => item.type === 'command').length;

const hasErrorMessage = (items: TimelineItem[] = []) =>
  items.some(item => item.type === 'message' && item.role === 'error');

export const shouldKeepLiveTimeline = (
  live: TimelineItem[],
  incoming: TimelineItem[],
  options?: { running?: boolean; liveUpdated?: number; incomingUpdated?: number },
) => {
  if (options?.running) return true;
  // thread/read can include a file change while omitting command executions.
  // Preserve the richer live stream in that case, and never hide a reported
  // turn failure just because it is not part of the thread transcript.
  if (hasErrorMessage(live)) return true;
  if (commandCount(live) > commandCount(incoming)) return true;
  const liveActivities = activityCount(live);
  const incomingActivities = activityCount(incoming);
  if (liveActivities > incomingActivities) return true;
  if (live.length > incoming.length) return true;
  if ((options?.liveUpdated || 0) > (options?.incomingUpdated || 0) && live.length >= incoming.length) return true;
  return false;
};

export const normalizeSession = (session: Session): Session => session;

// Codex threads are the source of truth for persisted conversations. A thread
// can be observed through both a live event and a subsequent thread/list read.
// Keep the first item so callers can deliberately prefer the fresher snapshot.
export const uniqueSessions = (sessions: Session[]): Session[] => {
  const ids = new Set<string>();
  const threadIds = new Set<string>();
  return sessions.filter(session => {
    if (ids.has(session.id) || (session.threadId && threadIds.has(session.threadId))) return false;
    ids.add(session.id);
    if (session.threadId) threadIds.add(session.threadId);
    return true;
  });
};

export const freshSession = (cwd = ''): Session => ({
  id: crypto.randomUUID(),
  title: '新建对话',
  cwd,
  timeline: [
    {
      id: 'ready',
      type: 'message',
      role: 'system',
      text: '准备就绪，您已选择项目文件夹：' + projectName(cwd),
    },
  ],
  updated: Date.now(),
  collaborationMode: 'default',
});

export const groupSessions = (sessions: Session[], projectPaths: string[] = []): SessionGroup[] => {
  const byPath = new Map<string, Session[]>();
  for (const projectPath of projectPaths) byPath.set(projectPath, []);
  for (const session of sessions) {
    const group = byPath.get(session.cwd) || [];
    group.push(session);
    byPath.set(session.cwd, group);
  }
  return [...byPath.entries()]
    .map(([cwd, items]) => ({
      cwd,
      items: items.sort((left, right) => right.updated - left.updated),
      updated: Math.max(0, ...items.map(item => item.updated)),
    }));
};

export const projectName = (cwd: string) =>
  cwd ? cwd.split(/[/\\]/).filter(Boolean).pop() || cwd : '未指定项目';

export const diffLineClass = (line: string) => {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-addition';
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-deletion';
  return '';
};
