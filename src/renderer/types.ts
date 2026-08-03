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
export type TrelloLabel = { id: string; name: string; color: string };
export type TrelloSubtask = { id: string; title: string; completed: boolean };
export type TrelloCard = {
  id: string;
  title: string;
  description: string;
  labelIds: string[];
  subtasks: TrelloSubtask[];
};
export type TrelloList = { id: string; title: string; cards: TrelloCard[] };
export type TrelloBoard = {
  version: 1;
  title: string;
  lists: TrelloList[];
  labels: TrelloLabel[];
  updatedAt: number;
};
export type ThemeChangedPayload = { theme: ThemeMode; effectiveTheme: 'light' | 'dark' };
export type PlanDecisionChoice = 'implement' | 'fresh' | 'stay';
export type AppSettings = { permissionMode: PermissionMode; fontSize: FontSize; theme: ThemeMode; codexPath?: string; model?: string; reasoningEffort?: string; projectPaths?: string[]; planDecisionChoices?: Record<string, PlanDecisionChoice> };
export type CodexInstallation =
  | { status: 'ready'; path: string; source: 'custom' | 'official' | 'npm' }
  | { status: 'missing' | 'invalid'; path?: string; error: string };
export type SaveCodexPathResult =
  | { ok: true; settings: AppSettings; installation: CodexInstallation }
  | { ok: false; error: string };
export type CodexProvider = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  reasoningEffort: string;
  hasApiKey: boolean;
};
export type CodexProviderInput = {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort: string;
};
export type CodexProviderState = {
  activeId: string;
  model: string;
  reasoningEffort: string;
  providers: CodexProvider[];
};
export type ProviderStateResult = { ok: true; state: CodexProviderState } | { ok: false; error: string };
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
  reportedAt?: number;
};

export type FileChange = {
  path: string;
  kind: string;
  diff?: string;
  diffTruncated?: boolean;
};

export type CommandActivity = {
  id: string;
  type: 'command';
  status: string;
  command: string;
  commandType: string;
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
  id: string; type: 'user_input'; status: 'pending' | 'answered' | 'cancelled'; questions: UserInputQuestion[];
  answers?: Record<string, { answers: string[] }>;
};

export type PlanDecisionActivity = {
  id: string;
  type: 'plan_decision';
  status: 'pending' | 'answered';
  plan: string;
  choice?: PlanDecisionChoice;
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
  tokenUsagePending?: boolean;
  archivedAt?: number;
};

export type SessionGroup = {
  cwd: string;
  items: Session[];
  updated: number;
};

export type ArchiveResult = { ok: true; succeededThreadIds?: string[] } | { ok: false; error?: string; succeededThreadIds?: string[] };
export type RestoreArchiveResult =
  | { ok: true; session: Session }
  | { ok: false; error?: string };
export type OpenPathResult = { ok: true } | { ok: false; error?: string };
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
  openTrello(): Promise<boolean>;
  loadTrelloBoard(): Promise<TrelloBoard>;
  saveTrelloBoard(board: TrelloBoard): Promise<TrelloBoard>;
  listSessions(): Promise<Session[]>;
  loadHistory(): Promise<Session[]>;
  loadSession(threadId: string): Promise<Session | null>;
  loadSessionTitles(): Promise<Record<string, string>>;
  saveSessionTitle(threadId: string, title: string): Promise<Record<string, string>>;
  getSettings(): Promise<AppSettings>;
  getUserName(): Promise<string>;
  saveSettings(settings: Partial<AppSettings>): Promise<AppSettings>;
  getCodexInstallation(): Promise<CodexInstallation>;
  saveCodexPath(codexPath: string): Promise<SaveCodexPathResult>;
  getProviders(): Promise<CodexProviderState>;
  saveProvider(provider: CodexProviderInput): Promise<ProviderStateResult>;
  activateProvider(id: string): Promise<ProviderStateResult>;
  deleteProvider(id: string): Promise<ProviderStateResult>;
  archiveSession(session: Session): Promise<ArchiveResult>;
  archiveProject(sessions: Session[]): Promise<ArchiveResult>;
  listArchivedSessions(): Promise<Session[]>;
  restoreArchivedSession(session: Pick<Session, 'id' | 'threadId'> | Session): Promise<RestoreArchiveResult>;
  removeArchivedSession(session: Pick<Session, 'id' | 'threadId'> | Session): Promise<ArchiveResult>;
  clearArchivedSessions(): Promise<ArchiveResult>;
  deleteProject(cwd: string, sessions: Session[]): Promise<ArchiveResult>;
  chooseFolder(): Promise<string | null>;
  chooseFiles(defaultPath?: string): Promise<string[]>;
  chooseCodexExecutable(defaultPath?: string): Promise<string | null>;
  listProjectFiles(cwd: string): Promise<string[]>;
  openPath(cwd: string | undefined, filePath: string): Promise<OpenPathResult>;
  openInVsCode(cwd: string | undefined, filePath: string): Promise<OpenPathResult>;
  openProjectDirectory(cwd: string | undefined): Promise<OpenPathResult>;
  openTerminal(cwd: string | undefined): Promise<OpenPathResult>;
  loadDiff(cwd: string, file: FileChange): Promise<FileChange | null>;
  getPathForFile(file: File): string;
  start(options: { sessionId: string; cwd: string; prompt: string; attachments: CodexAttachment[]; skill?: Pick<CodexSkill, 'name' | 'path'>; threadId?: string; model?: string; reasoningEffort?: string; collaborationMode?: CollaborationMode; permissionMode: PermissionMode }): Promise<boolean>;
  stop(sessionId: string): Promise<boolean>;
  compact(sessionId: string, threadId?: string): Promise<boolean>;
  rollback(sessionId: string, threadId: string): Promise<Session | false>;
  listModels(): Promise<CodexModel[]>;
  listCollaborationModes(): Promise<CollaborationMode[]>;
  listSkills(cwd: string, forceReload?: boolean): Promise<CodexSkill[]>;
  answerUserInput(itemId: string, answers: Record<string, { answers: string[] }>): Promise<boolean>;
  onData(callback: (value: { sessionId: string; itemId: string; text: string; full?: boolean }) => void): () => void;
  onActivity(callback: (value: { sessionId: string; activity: Activity }) => void): () => void;
  onThread(callback: (value: { sessionId: string; threadId: string }) => void): () => void;
  onExit(callback: (value: { sessionId: string; code?: number; status?: string; hasPlan?: boolean; hadError?: boolean }) => void): () => void;
  onError(callback: (value: { sessionId: string; error: string }) => void): () => void;
  onCompacted(callback: (value: { sessionId: string }) => void): () => void;
  onStatus(callback: (value: { sessionId: string; status: ThreadStatus }) => void): () => void;
  onTokenUsage(callback: (value: { sessionId: string; tokenUsage: ThreadTokenUsage }) => void): () => void;
  onTokenUsagePending(callback: (value: { sessionId: string }) => void): () => void;
  onUserInput(callback: (value: { sessionId: string; request: { itemId: string; questions: UserInputQuestion[] } }) => void): () => void;
  onPlanReady(callback: (value: { sessionId: string; plan: { itemId: string; text: string } }) => void): () => void;
  onSkillsChanged(callback: () => void): () => void;
  onFocusSession(callback: (value: { sessionId: string }) => void): () => void;
  onThemeChanged(callback: (value: ThemeChangedPayload) => void): () => void;
};

declare global {
  interface Window {
    codex: CodexApi;
  }
}
