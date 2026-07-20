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

export const normalizeSession = (session: Session): Session => ({
  ...session,
  timeline: timelineOf(session),
});

export const freshSession = (cwd = ''): Session => ({
  id: crypto.randomUUID(),
  title: '新建对话',
  cwd,
  timeline: [
    {
      id: 'ready',
      type: 'message',
      role: 'system',
      text: '准备就绪。选择项目文件夹后即可向 Codex 发送消息。',
    },
  ],
  updated: Date.now(),
  collaborationMode: 'default',
});

export const groupSessions = (sessions: Session[]): SessionGroup[] => {
  const byPath = new Map<string, Session[]>();
  for (const session of sessions) {
    const group = byPath.get(session.cwd) || [];
    group.push(session);
    byPath.set(session.cwd, group);
  }
  return [...byPath.entries()]
    .map(([cwd, items]) => ({
      cwd,
      items: items.sort((left, right) => right.updated - left.updated),
      updated: Math.max(...items.map(item => item.updated)),
    }))
    .sort((left, right) => right.updated - left.updated);
};

export const projectName = (cwd: string) =>
  cwd ? cwd.split(/[/\\]/).filter(Boolean).pop() || cwd : '未指定项目';

export const diffLineClass = (line: string) => {
  if (line.startsWith('+') && !line.startsWith('+++')) return 'diff-addition';
  if (line.startsWith('-') && !line.startsWith('---')) return 'diff-deletion';
  return '';
};
