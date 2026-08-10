export type Session = {
  id: string;
  threadId?: string;
  title: string;
  cwd: string;
  updated: number;
  model?: string;
  archivedAt?: number;
};

export type ArchiveResult = {
  ok: boolean;
  error?: string;
  succeededThreadIds?: string[];
};

export type RestoreArchiveResult = {
  ok: boolean;
  error?: string;
};

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

export type ProviderStateResult =
  | { ok: true; state: CodexProviderState }
  | { ok: false; error: string };

export type FontSize = 'small' | 'medium' | 'large';
export type Theme = 'light' | 'dark';

export type AppSettings = {
  fontSize: FontSize;
  theme: Theme;
};

export type CodexApi = {
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<AppSettings>;
  getProviders(): Promise<CodexProviderState>;
  saveProvider(provider: CodexProviderInput): Promise<ProviderStateResult>;
  activateProvider(id: string): Promise<ProviderStateResult>;
  deleteProvider(id: string): Promise<ProviderStateResult>;
  listArchivedSessions(): Promise<Session[]>;
  restoreArchivedSession(session: Pick<Session, 'id' | 'threadId'> | Session): Promise<RestoreArchiveResult>;
  removeArchivedSession(session: Pick<Session, 'id' | 'threadId'> | Session): Promise<ArchiveResult>;
  clearArchivedSessions(): Promise<ArchiveResult>;
};

declare global {
  interface Window {
    codex: CodexApi;
  }
}
