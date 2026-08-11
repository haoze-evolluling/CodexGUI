import type { ActionResult, AppSettings, BootstrapState, ProviderInput, ProviderResult, Session } from './types'

type AppBinding = Record<string, (...args: any[]) => Promise<any>>
function app(): AppBinding {
  const root = (window as any).go
  const binding = root?.backend?.App ?? root?.main?.App
  if (!binding) throw new Error('Wails 后端尚未连接。')
  return binding
}
export const api = {
  bootstrap: (): Promise<BootstrapState> => app().Bootstrap(),
  listArchived: (): Promise<Session[]> => app().ListArchivedSessions(),
  restore: (id: string): Promise<ActionResult> => app().RestoreArchivedSession(id),
  remove: (id: string): Promise<ActionResult> => app().RemoveArchivedSession(id),
  clear: (): Promise<ActionResult> => app().ClearArchivedSessions(),
  saveProvider: (value: ProviderInput): Promise<ProviderResult> => app().SaveProvider(value),
  activateProvider: (id: string): Promise<ProviderResult> => app().ActivateProvider(id),
  deleteProvider: (id: string): Promise<ProviderResult> => app().DeleteProvider(id),
  saveSettings: (value: AppSettings): Promise<AppSettings> => app().SaveSettings(value),
}
