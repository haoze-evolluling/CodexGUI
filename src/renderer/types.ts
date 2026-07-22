export type Message = {
  role: 'user' | 'assistant' | 'system' | 'error';
  text: string;
  attachments?: CodexAttachment[];
};

export type AttachmentKind = 'image' | 'code' | 'pdf' | 'document' | 'spreadsheet' | 'archive' | 'file';
export type CodexAttachment = { id: string; path: string; name: string; kind: AttachmentKind };
export type CodexSkill = {
  name: string;
  description: string;
  path: string;
  scope: 'user' | 'repo' | 'system' | 'admin';
  shortDescription?: string | null;
  interface?: {
    displayName?: string | null;
    shortDescription?: string | null;
  } | null;
};
export type PermissionMode = 'default' | 'yolo';
export type FontSize = 'small' | 'medium' | 'large';
export type ThemeMode = 'light' | 'dark' | 'system';
export type AppSettings = { permissionMode: PermissionMode; fontSize: FontSize; theme: ThemeMode; codexPath?: string; model?: string; reasoningEffort?: string; projectPaths?: string[] };
export type CodexInstallation =
  | { status: 'ready'; path: string; source: 'custom' | 'official' | 'npm' }
  | { status: 'missing' | 'invalid'; path?: string; error: string };
export type SaveCodexPathResult =
  | { ok: true; settings: AppSettings; installation: CodexInstallation }
  | { ok: false; error: string };
export type ThreadStatus = {
  type: 'notLoaded' | 'idle' | 'systemError' | 'active';
  activeFlags?: ('waitingOnApproval' | 'waitingOnUserInput')[];
};
export type TokenUsageBreakdown = {
  cachedInputTokens: number;
  inputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
};
export type ThreadTokenUsage = {
  last: TokenUsageBreakdown;
  total: TokenUsageBreakdown;
  modelContextWindow?: number | null;
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

export type CompactionActivity = { id: string; type: 'compaction'; status: string };
export type UserInputOption = { label: string; description: string };
export type UserInputQuestion = {
  id: string; header: string; question: string; options?: UserInputOption[] | null;
  isOther?: boolean; isSecret?: boolean;
};
export type UserInputActivity = {
  id: string; type: 'user_input'; status: 'pending' | 'answered'; questions: UserInputQuestion[];
  answers?: Record<string, { answers: string[] }>;
};

export type PlanDecisionActivity = {
  id: string;
  type: 'plan_decision';
  status: 'pending' | 'answered';
  plan: string;
  choice?: 'implement' | 'fresh' | 'stay';
};

export type Activity = CommandActivity | FileChangeActivity | CompactionActivity | UserInputActivity | PlanDecisionActivity;

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
  model?: string;
  reasoningEffort?: string;
  collaborationMode?: 'default' | 'plan';
  threadStatus?: ThreadStatus;
  tokenUsage?: ThreadTokenUsage;
};

export type SessionGroup = {
  cwd: string;
  items: Session[];
  updated: number;
};

export type ArchiveResult = { ok: true } | { ok: false; error?: string };
export type CodexModel = {
  id: string; model: string; displayName: string; description: string; isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
};
export type CollaborationMode = {
  name: string; mode?: 'default' | 'plan' | null; model?: string | null; reasoning_effort?: string | null;
};

export type CodexApi = {
  minimizeWindow(): Promise<void>;
  toggleMaximizeWindow(): Promise<boolean>;
  closeWindow(): Promise<void>;
  listSessions(): Promise<Session[]>;
  loadHistory(): Promise<Session[]>;
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  getCodexInstallation(): Promise<CodexInstallation>;
  saveCodexPath(codexPath: string): Promise<SaveCodexPathResult>;
  saveSession(session: Session): Promise<Session[]>;
  archiveSession(session: Session): Promise<ArchiveResult>;
  archiveProject(sessions: Session[]): Promise<ArchiveResult>;
  chooseFolder(): Promise<string | null>;
  chooseFiles(defaultPath?: string): Promise<string[]>;
  chooseCodexExecutable(defaultPath?: string): Promise<string | null>;
  getPathForFile(file: File): string;
  start(options: { sessionId: string; cwd: string; prompt: string; attachments: CodexAttachment[]; skill?: Pick<CodexSkill, 'name' | 'path'>; threadId?: string; model?: string; reasoningEffort?: string; collaborationMode?: CollaborationMode; permissionMode: PermissionMode }): Promise<boolean>;
  stop(sessionId: string): Promise<boolean>;
  compact(sessionId: string, threadId?: string): Promise<boolean>;
  rollback(sessionId: string, threadId: string): Promise<boolean>;
  resetSession(sessionId: string): Promise<boolean>;
  listModels(): Promise<CodexModel[]>;
  listCollaborationModes(): Promise<CollaborationMode[]>;
  listSkills(cwd: string, forceReload?: boolean): Promise<CodexSkill[]>;
  answerUserInput(itemId: string, answers: Record<string, { answers: string[] }>): Promise<boolean>;
  onData(callback: (value: { sessionId: string; itemId: string; text: string; full?: boolean }) => void): () => void;
  onActivity(callback: (value: { sessionId: string; activity: Activity }) => void): () => void;
  onThread(callback: (value: { sessionId: string; threadId: string }) => void): () => void;
  onExit(callback: (value: { sessionId: string; code?: number }) => void): () => void;
  onError(callback: (value: { sessionId: string; error: string }) => void): () => void;
  onCompacted(callback: (value: { sessionId: string }) => void): () => void;
  onStatus(callback: (value: { sessionId: string; status: ThreadStatus }) => void): () => void;
  onTokenUsage(callback: (value: { sessionId: string; tokenUsage: ThreadTokenUsage }) => void): () => void;
  onUserInput(callback: (value: { sessionId: string; request: { itemId: string; questions: UserInputQuestion[] } }) => void): () => void;
  onPlanReady(callback: (value: { sessionId: string; plan: { itemId: string; text: string } }) => void): () => void;
  onSkillsChanged(callback: () => void): () => void;
};

declare global {
  interface Window {
    codex: CodexApi;
  }
}
