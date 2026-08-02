import { Check, CheckCircle2, Clipboard, Eye, EyeOff, FolderOpen, Monitor, Moon, Plus, RotateCcw, Save, Settings, Sun, Trash2, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CodexInstallation, CodexProviderInput, CodexProviderState, FontSize, ProviderStateResult, SaveCodexPathResult, ThemeMode } from '../types';

const installCommand = 'npm install -g @openai/codex';
const sourceLabels = { custom: '自定义路径', official: '官方版本', npm: 'NPM 版本' } as const;
const fontSizeOptions: Array<{ value: FontSize; label: string; hint: string }> = [
  { value: 'small', label: '小', hint: '当前默认，14px' },
  { value: 'medium', label: '中', hint: '稍大，16px' },
  { value: 'large', label: '大', hint: '更易读，18px' },
];
const themeOptions: Array<{ value: ThemeMode; label: string; hint: string; icon: typeof Sun }> = [
  { value: 'light', label: '浅色模式', hint: '明亮、清晰的工作界面', icon: Sun },
  { value: 'dark', label: '深色模式', hint: '低光环境下更舒适', icon: Moon },
  { value: 'system', label: '跟随系统', hint: '随系统外观自动切换', icon: Monitor },
];

type SettingsPageProps = {
  codexPath?: string;
  fontSize: FontSize;
  theme: ThemeMode;
  installation?: CodexInstallation;
  providerState?: CodexProviderState;
  savingDisabled: boolean;
  onClose(): void;
  onFontSizeChange(size: FontSize): void;
  onThemeChange(theme: ThemeMode): void;
  onSave(path: string): Promise<SaveCodexPathResult>;
  onProviderSave(provider: CodexProviderInput): Promise<ProviderStateResult>;
  onProviderActivate(id: string): Promise<ProviderStateResult>;
  onProviderDelete(id: string): Promise<ProviderStateResult>;
};

export function SettingsPage(props: SettingsPageProps) {
  const [path, setPath] = useState(props.codexPath || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [providerId, setProviderId] = useState<string>();
  const [providerName, setProviderName] = useState('');
  const [providerBaseUrl, setProviderBaseUrl] = useState('');
  const [providerApiKey, setProviderApiKey] = useState('');
  const [providerModel, setProviderModel] = useState('');
  const [providerEffort, setProviderEffort] = useState('medium');
  const [providerError, setProviderError] = useState('');
  const [providerSaving, setProviderSaving] = useState(false);
  const [providerKeyVisible, setProviderKeyVisible] = useState(false);

  useEffect(() => setPath(props.codexPath || ''), [props.codexPath]);

  const resetProviderForm = () => {
    setProviderId(undefined);
    setProviderName('');
    setProviderBaseUrl('');
    setProviderApiKey('');
    setProviderModel('');
    setProviderEffort('medium');
    setProviderError('');
    setProviderKeyVisible(false);
  };

  const editProvider = (id: string, source = props.providerState) => {
    const provider = source?.providers.find(item => item.id === id);
    if (!provider) return;
    setProviderId(provider.id);
    setProviderName(provider.name);
    setProviderBaseUrl(provider.baseUrl);
    setProviderApiKey('');
    setProviderModel(provider.model);
    setProviderEffort(provider.reasoningEffort);
    setProviderError('');
    setProviderKeyVisible(false);
  };

  useEffect(() => {
    const active = props.providerState?.activeId;
    if (active && !providerId) editProvider(active);
  }, [props.providerState?.activeId]);

  const saveProvider = async () => {
    setProviderSaving(true);
    setProviderError('');
    try {
      const result = await props.onProviderSave({
        ...(providerId ? { id: providerId } : {}),
        name: providerName,
        baseUrl: providerBaseUrl,
        apiKey: providerApiKey,
        model: providerModel,
        reasoningEffort: providerEffort,
      });
      if (!result.ok) setProviderError(result.error);
      else if (!providerId) {
        const saved = result.state.providers.find(item => item.name === providerName.trim());
        if (saved) setProviderId(saved.id);
      }
      setProviderApiKey('');
    } catch (cause) {
      setProviderError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProviderSaving(false);
    }
  };

  const activateProvider = async (id: string) => {
    setProviderSaving(true);
    setProviderError('');
    try {
      const result = await props.onProviderActivate(id);
      if (!result.ok) setProviderError(result.error);
      else editProvider(id, result.state);
    } catch (cause) {
      setProviderError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProviderSaving(false);
    }
  };

  const deleteProvider = async (id: string) => {
    setProviderSaving(true);
    setProviderError('');
    try {
      const result = await props.onProviderDelete(id);
      if (!result.ok) setProviderError(result.error);
      else if (providerId === id) resetProviderForm();
    } catch (cause) {
      setProviderError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setProviderSaving(false);
    }
  };

  const chooseExecutable = async () => {
    const selected = await window.codex.chooseCodexExecutable(path || props.installation?.path);
    if (selected) {
      setPath(selected);
      setError('');
    }
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      const result = await props.onSave(path);
      if (!result.ok) setError(result.error);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const copyInstallCommand = async () => {
    await navigator.clipboard.writeText(installCommand);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const readyInstallation = props.installation?.status === 'ready' ? props.installation : undefined;
  const installationError = props.installation && props.installation.status !== 'ready'
    ? props.installation.error
    : undefined;

  return (
    <main className="settings-page">
      <header className="settings-page-header">
        <div>
          <b>设置</b>
          <span className="path">调整应用外观、字体与 Codex 路径</span>
        </div>
        <div className="header-actions">
          <button className="icon" onClick={props.onClose} title="返回对话" aria-label="返回对话">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="settings-page-body">
        <section className="settings-section provider-section">
          <div className="settings-section-title">
            <Settings size={18} />
            <div>
              <b>自定义提供商</b>
              <p className="settings-hint">提供商配置由 Codex 直接读取。API Key 只在当前配置中写入 Codex，其他提供商使用系统加密保存。</p>
            </div>
          </div>

          <div className="provider-layout">
            <div className="provider-list" aria-label="已保存的提供商">
              {props.providerState?.providers.map(provider => {
                const active = provider.id === props.providerState?.activeId;
                return <div key={provider.id} className={`provider-item ${active ? 'selected' : ''}`}>
                  <button type="button" className="provider-item-main" onClick={() => editProvider(provider.id)}>
                    <span className="provider-item-name">{active && <Check size={15} />}{provider.name}</span>
                    <small>{provider.model} · {provider.baseUrl}</small>
                    <small>{provider.hasApiKey ? 'API Key 已配置' : '缺少 API Key'}</small>
                  </button>
                  <div className="provider-item-actions">
                    {!active && <button type="button" className="icon" onClick={() => void activateProvider(provider.id)} title="切换到此提供商" aria-label={`切换到${provider.name}`} disabled={providerSaving || props.savingDisabled}><Check size={16} /></button>}
                    <button type="button" className="icon" onClick={() => void deleteProvider(provider.id)} title="删除提供商" aria-label={`删除${provider.name}`} disabled={providerSaving || props.savingDisabled || active}><Trash2 size={16} /></button>
                  </div>
                </div>;
              })}
              {!props.providerState?.providers.length && <p className="provider-empty">尚未保存提供商。</p>}
              <button type="button" className="provider-new" onClick={resetProviderForm} disabled={providerSaving || props.savingDisabled}><Plus size={15} /> 新建提供商</button>
            </div>

            <div className="provider-form">
              <label className="settings-field-label" htmlFor="provider-name">提供商名称</label>
              <input id="provider-name" value={providerName} onChange={event => setProviderName(event.target.value)} placeholder="例如：我的 API" />
              <label className="settings-field-label" htmlFor="provider-base-url">请求地址</label>
              <input id="provider-base-url" value={providerBaseUrl} onChange={event => setProviderBaseUrl(event.target.value)} placeholder="https://api.example.com" spellCheck={false} />
              <label className="settings-field-label" htmlFor="provider-api-key">API Key</label>
              <div className="provider-secret-field">
                <input id="provider-api-key" type={providerKeyVisible ? 'text' : 'password'} value={providerApiKey} onChange={event => setProviderApiKey(event.target.value)} placeholder={providerId && props.providerState?.providers.find(item => item.id === providerId)?.hasApiKey ? '留空以保留当前 Key' : '输入 API Key'} spellCheck={false} />
                <button type="button" className="icon" onClick={() => setProviderKeyVisible(value => !value)} title={providerKeyVisible ? '隐藏 API Key' : '显示 API Key'} aria-label={providerKeyVisible ? '隐藏 API Key' : '显示 API Key'}><>{providerKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}</></button>
              </div>
              <label className="settings-field-label" htmlFor="provider-model">默认模型</label>
              <input id="provider-model" value={providerModel} onChange={event => setProviderModel(event.target.value)} placeholder="例如：gpt-5" spellCheck={false} />
              <label className="settings-field-label" htmlFor="provider-effort">默认推理强度</label>
              <select id="provider-effort" value={providerEffort} onChange={event => setProviderEffort(event.target.value)}>
                <option value="minimal">minimal</option>
                <option value="low">low</option>
                <option value="medium">medium</option>
                <option value="high">high</option>
                <option value="xhigh">xhigh</option>
              </select>
              {props.savingDisabled && <p className="settings-warning">Codex 正在执行任务，请在任务结束后操作提供商。</p>}
              {providerError && <p className="settings-error">{providerError}</p>}
              <div className="settings-actions">
                <button className="primary" type="button" onClick={() => void saveProvider()} disabled={providerSaving || props.savingDisabled || !providerName.trim() || !providerBaseUrl.trim() || !providerModel.trim()}><Save size={15} /> {providerSaving ? '保存中…' : '保存提供商'}</button>
              </div>
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <Sun size={18} />
            <div>
              <b>外观</b>
              <p className="settings-hint">选择应用的显示主题。</p>
            </div>
          </div>
          <div className="theme-options" role="radiogroup" aria-label="主题模式">
            {themeOptions.map(option => {
              const Icon = option.icon;
              return <button key={option.value} type="button" className={`theme-option ${props.theme === option.value ? 'selected' : ''}`} onClick={() => props.onThemeChange(option.value)} role="radio" aria-checked={props.theme === option.value}>
                <Icon size={18} />
                <span><b>{option.label}</b><small>{option.hint}</small></span>
              </button>;
            })}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <Settings size={18} />
            <div>
              <b>界面字体</b>
              <p className="settings-hint">调整对话内容与输入框的字号，当前默认档位为“小”。</p>
            </div>
          </div>
          <div className="font-size-options" role="radiogroup" aria-label="字体大小">
            {fontSizeOptions.map(option => (
              <button
                key={option.value}
                type="button"
                className={`font-size-option ${props.fontSize === option.value ? 'selected' : ''}`}
                onClick={() => props.onFontSizeChange(option.value)}
                role="radio"
                aria-checked={props.fontSize === option.value}
              >
                <b>{option.label}</b>
                <small>{option.hint}</small>
              </button>
            ))}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-section-title">
            <Settings size={18} />
            <div>
              <b>Codex 安装路径</b>
              <p className="settings-hint">选择 Codex 的可执行入口。留空时将自动搜索官方版本和 NPM 版本。</p>
            </div>
          </div>
          <label className="settings-field-label" htmlFor="codex-path">可执行文件路径</label>
          <div className="path-field">
            <input
              id="codex-path"
              value={path}
              onChange={event => { setPath(event.target.value); setError(''); }}
              placeholder={readyInstallation?.path || '自动检测'}
              spellCheck={false}
            />
            <button className="icon" onClick={chooseExecutable} title="浏览 Codex 可执行文件" aria-label="浏览 Codex 可执行文件">
              <FolderOpen size={18} />
            </button>
          </div>
          <button className="reset-path" onClick={() => { setPath(''); setError(''); }} disabled={!path}>
            <RotateCcw size={15} /> 恢复自动检测
          </button>

          <div className={`installation-status ${readyInstallation ? 'ready' : 'missing'}`}>
            {readyInstallation ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
            <div>
              <b>{readyInstallation ? `已找到 Codex（${sourceLabels[readyInstallation.source]}）` : '未找到可用的 Codex'}</b>
              <span title={readyInstallation?.path || installationError}>{readyInstallation?.path || installationError}</span>
            </div>
          </div>

          {!readyInstallation && (
            <div className="install-command">
              <span>安装命令</span>
              <code>{installCommand}</code>
              <button className="icon" onClick={copyInstallCommand} title="复制安装命令" aria-label="复制安装命令">
                {copied ? <CheckCircle2 size={17} /> : <Clipboard size={17} />}
              </button>
            </div>
          )}

          {props.savingDisabled && <p className="settings-warning">Codex 正在执行任务，请在任务结束后更改路径。</p>}
          {error && <p className="settings-error">{error}</p>}

          <div className="settings-actions">
            <button className="primary" onClick={save} disabled={saving || props.savingDisabled}>
              {saving ? '保存中…' : '保存路径'}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
