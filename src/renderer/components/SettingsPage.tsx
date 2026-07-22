import { CheckCircle2, Clipboard, FolderOpen, Monitor, Moon, RotateCcw, Settings, Sun, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CodexInstallation, FontSize, SaveCodexPathResult, ThemeMode } from '../types';

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
  savingDisabled: boolean;
  onClose(): void;
  onFontSizeChange(size: FontSize): void;
  onThemeChange(theme: ThemeMode): void;
  onSave(path: string): Promise<SaveCodexPathResult>;
};

export function SettingsPage(props: SettingsPageProps) {
  const [path, setPath] = useState(props.codexPath || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => setPath(props.codexPath || ''), [props.codexPath]);

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
