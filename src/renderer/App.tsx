import { Archive, CheckCircle2, RefreshCw, Settings } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppSettingsPage } from './components/AppSettingsPage';
import { ArchivePage } from './components/ArchivePage';
import { SettingsPage } from './components/SettingsPage';
import type { AppSettings, ArchiveResult, CodexProviderInput, CodexProviderState, ProviderStateResult, Session } from './types';

type Page = 'archive' | 'providers' | 'settings';

const defaultSettings: AppSettings = { fontSize: 'medium', theme: 'dark' };

export function App() {
  const [page, setPage] = useState<Page>('providers');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [providerState, setProviderState] = useState<CodexProviderState>();
  const [settings, setSettings] = useState<AppSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = async (showLoading = false) => {
    if (showLoading) setLoading(true);
    setError('');
    try {
      const [archivedResult, providerResult, settingsResult] = await Promise.allSettled([
        window.codex.listArchivedSessions(),
        window.codex.getProviders(),
        window.codex.getSettings(),
      ]);
      const errors: string[] = [];
      if (archivedResult.status === 'fulfilled') setSessions(archivedResult.value || []);
      else errors.push(`归档数据加载失败：${archivedResult.reason instanceof Error ? archivedResult.reason.message : String(archivedResult.reason)}`);
      if (providerResult.status === 'fulfilled') setProviderState(providerResult.value);
      else errors.push(`提供商数据加载失败：${providerResult.reason instanceof Error ? providerResult.reason.message : String(providerResult.reason)}`);
      if (settingsResult.status === 'fulfilled') setSettings({ ...defaultSettings, ...settingsResult.value });
      else errors.push(`应用设置加载失败：${settingsResult.reason instanceof Error ? settingsResult.reason.message : String(settingsResult.reason)}`);
      if (errors.length) setError(errors.join('；'));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(true); }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
  }, [settings.theme]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const runArchiveAction = async (action: () => Promise<ArchiveResult | { ok: boolean; error?: string }>) => {
    const result = await action();
    if (!result.ok) {
      setError(result.error || '操作失败。');
      return;
    }
    await refresh();
  };

  const saveProvider = async (input: CodexProviderInput): Promise<ProviderStateResult> => {
    const result = await window.codex.saveProvider(input);
    if (result.ok) setProviderState(result.state);
    return result;
  };

  const activateProvider = async (id: string): Promise<ProviderStateResult> => {
    const result = await window.codex.activateProvider(id);
    if (result.ok) setProviderState(result.state);
    return result;
  };

  const deleteProvider = async (id: string): Promise<ProviderStateResult> => {
    const result = await window.codex.deleteProvider(id);
    if (result.ok) setProviderState(result.state);
    return result;
  };

  const saveSettings = async (next: AppSettings): Promise<AppSettings> => {
    const result = await window.codex.saveSettings(next);
    setSettings(result);
    return result;
  };

  return (
    <div className={`app font-size-${settings.fontSize}`}>
      <header className="app-header">
        <div className="brand">
          <CheckCircle2 size={20} />
          <div><b>Codex GUI</b><span>归档与模型管理</span></div>
        </div>
        <button className="icon" onClick={() => void refresh()} disabled={loading || refreshing} title="刷新" aria-label="刷新">
          <RefreshCw size={18} className={refreshing ? 'spin' : ''} />
        </button>
      </header>
      <div className="app-body">
        <nav className="module-nav" aria-label="功能模块">
          <button className={page === 'archive' ? 'selected' : ''} onClick={() => setPage('archive')}>
            <Archive size={18} /><span>归档管理</span><small>{sessions.length}</small>
          </button>
          <button className={page === 'providers' ? 'selected' : ''} onClick={() => setPage('providers')}>
            <Settings size={18} /><span>模型提供商</span>
          </button>
          <button className={page === 'settings' ? 'selected' : ''} onClick={() => setPage('settings')}>
            <Settings size={18} /><span>应用设置</span>
          </button>
        </nav>
        <main className="content-page">
          {error && <div className="global-error" role="alert">{error}</div>}
          {loading ? <div className="loading-state">正在加载管理数据…</div> : page === 'archive' ? (
            <ArchivePage
              sessions={sessions}
              onRefresh={refresh}
              onRestore={session => void runArchiveAction(() => window.codex.restoreArchivedSession(session))}
              onRemove={session => void runArchiveAction(() => window.codex.removeArchivedSession(session))}
              onClear={() => void runArchiveAction(() => window.codex.clearArchivedSessions())}
            />
          ) : page === 'providers' ? (
            <SettingsPage
              providerState={providerState}
              onProviderSave={saveProvider}
              onProviderActivate={activateProvider}
              onProviderDelete={deleteProvider}
            />
          ) : (
            <AppSettingsPage settings={settings} onSave={saveSettings} />
          )}
        </main>
      </div>
    </div>
  );
}
