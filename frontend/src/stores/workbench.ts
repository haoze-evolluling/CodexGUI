import { defineStore } from 'pinia'
import { api } from '../services'
import type { AppSettings, InstallationStatus, ProviderState, Session } from '../types'

const defaults: AppSettings = { theme: 'dark', fontSize: 'medium' }
export const useWorkbenchStore = defineStore('workbench', {
  state: () => ({ settings: defaults as AppSettings, providers: { activeId: '', model: '', reasoningEffort: '', providers: [] } as ProviderState, installation: { status: 'missing' } as InstallationStatus, sessions: [] as Session[], loading: true, refreshing: false, error: '' }),
  actions: {
    async bootstrap() { this.loading = true; this.error = ''; try { const state = await api.bootstrap(); this.settings = state.settings; this.providers = state.providers; this.installation = state.installation; await this.refreshSessions() } catch (error) { this.error = error instanceof Error ? error.message : String(error) } finally { this.loading = false } },
    async refreshSessions() { this.refreshing = true; try { this.sessions = await api.listArchived() } catch (error) { this.error = error instanceof Error ? error.message : String(error) } finally { this.refreshing = false } },
    async refreshAll() { await this.bootstrap() },
    async saveSettings(settings: AppSettings) { this.settings = await api.saveSettings(settings) },
    async useProvider(action: Promise<any>) { const result = await action; if (!result.ok) throw new Error(result.error || '操作失败。'); this.providers = result.state },
  },
})
