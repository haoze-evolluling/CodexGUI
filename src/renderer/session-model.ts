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
