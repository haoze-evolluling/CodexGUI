export type Message = {
  role: 'user' | 'assistant' | 'system' | 'error';
  text: string;
};

export type FileChange = {
  path: string;
  kind: string;
  diff?: string;
};

export type CommandActivity = {
  id: string;
  type: 'command';
  status: string;
  command: string;
  output: string;
  exitCode?: number;
};

export type FileChangeActivity = {
  id: string;
  type: 'file_change';
  status: string;
  files: FileChange[];
};

export type Activity = CommandActivity | FileChangeActivity;

export type TimelineItem =
  | ({ id: string; type: 'message' } & Message)
  | Activity;

export type Session = {
  id: string;
  title: string;
  cwd: string;
  messages?: Message[];
  timeline?: TimelineItem[];
  updated: number;
  threadId?: string;
};

export type SessionGroup = {
  cwd: string;
  items: Session[];
  updated: number;
};

export type ArchiveResult = { ok: true } | { ok: false; error?: string };

export type CodexApi = {
  listSessions(): Promise<Session[]>;
  loadHistory(): Promise<Session[]>;
  saveSession(session: Session): Promise<Session[]>;
  archiveSession(session: Session): Promise<ArchiveResult>;
  archiveProject(sessions: Session[]): Promise<ArchiveResult>;
  chooseFolder(): Promise<string | null>;
  start(options: { sessionId: string; cwd: string; prompt: string; threadId?: string }): Promise<boolean>;
  stop(sessionId: string): Promise<boolean>;
  onData(callback: (value: { sessionId: string; stream: string; text: string }) => void): () => void;
  onActivity(callback: (value: { sessionId: string; activity: Activity }) => void): () => void;
  onThread(callback: (value: { sessionId: string; threadId: string }) => void): () => void;
  onExit(callback: (value: { sessionId: string; code?: number }) => void): () => void;
  onError(callback: (value: { sessionId: string; error: string }) => void): () => void;
};

declare global {
  interface Window {
    codex: CodexApi;
  }
}
