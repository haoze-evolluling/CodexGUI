export type Theme = 'light' | 'dark'
export type FontSize = 'small' | 'medium' | 'large'
export interface AppSettings { theme: Theme; fontSize: FontSize; codexPath?: string }
export interface Session { id: string; threadId: string; title: string; cwd: string; updated: number; model?: string; archivedAt?: number }
export interface Provider { id: string; name: string; baseUrl: string; model: string; reasoningEffort: string; hasApiKey: boolean }
export interface ProviderInput { id?: string; name: string; baseUrl: string; apiKey: string; model: string; reasoningEffort: string }
export interface ProviderState { activeId: string; model: string; reasoningEffort: string; providers: Provider[] }
export interface InstallationStatus { status: string; path?: string; source?: string; error?: string }
export interface ActionResult { ok: boolean; error?: string }
export interface ProviderResult extends ActionResult { state: ProviderState }
export interface BootstrapState { settings: AppSettings; providers: ProviderState; installation: InstallationStatus }
