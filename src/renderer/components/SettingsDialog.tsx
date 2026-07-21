import { CheckCircle2, Clipboard, FolderOpen, RotateCcw, Settings, TriangleAlert, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CodexInstallation, SaveCodexPathResult } from '../types';

const installCommand = 'npm install -g @openai/codex';
const sourceLabels = { custom: '自定义路径', official: '官方版本', npm: 'NPM 版本' } as const;

type SettingsDialogProps = {
  codexPath?: string;
  installation?: CodexInstallation;
  savingDisabled: boolean;
  onClose(): void;
  onSave(path: string): Promise<SaveCodexPathResult>;
};

export function SettingsDialog(props: SettingsDialogProps) {
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
      if (result.ok) props.onClose();
      else setError(result.error);
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
  return (
    <div className="settings-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose(); }}>
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title" onKeyDown={event => { if (event.key === 'Escape') props.onClose(); }}>
        <header className="settings-header">
          <div><Settings size={18} /><b id="settings-title">设置</b></div>
          <button className="icon" onClick={props.onClose} title="关闭设置" aria-label="关闭设置"><X size={18} /></button>
        </header>

        <div className="settings-content">
          <label htmlFor="codex-path">Codex 安装路径</label>
          <p className="settings-hint">选择 Codex 的可执行入口。留空时将自动搜索官方版本和 NPM 版本。</p>
          <div className="path-field">
            <input
              id="codex-path"
              value={path}
              onChange={event => { setPath(event.target.value); setError(''); }}
              placeholder={readyInstallation?.path || '自动检测'}
              spellCheck={false}
            />
            <button className="icon" onClick={chooseExecutable} title="浏览 Codex 可执行文件" aria-label="浏览 Codex 可执行文件"><FolderOpen size={18} /></button>
          </div>
          <button className="reset-path" onClick={() => { setPath(''); setError(''); }} disabled={!path}>
            <RotateCcw size={15} /> 恢复自动检测
          </button>

          <div className={`installation-status ${readyInstallation ? 'ready' : 'missing'}`}>
            {readyInstallation ? <CheckCircle2 size={18} /> : <TriangleAlert size={18} />}
            <div>
              <b>{readyInstallation ? `已找到 Codex（${sourceLabels[readyInstallation.source]}）` : '未找到可用的 Codex'}</b>
              <span title={readyInstallation?.path}>{readyInstallation?.path || props.installation?.error}</span>
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
        </div>

        <footer className="settings-actions">
          <button onClick={props.onClose}>取消</button>
          <button className="primary" onClick={save} disabled={saving || props.savingDisabled}>{saving ? '保存中…' : '保存'}</button>
        </footer>
      </section>
    </div>
  );
}
