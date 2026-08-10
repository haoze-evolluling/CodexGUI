import { Moon, Sun, Type, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import type { AppSettings, FontSize, Theme } from '../types';

export type AppSettingsPageProps = {
  settings: AppSettings;
  onSave(settings: AppSettings): Promise<AppSettings>;
};

export function AppSettingsPage(props: AppSettingsPageProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = async (patch: Partial<AppSettings>) => {
    setSaving(true);
    setError('');
    try {
      await props.onSave({ ...props.settings, ...patch });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const themeOptions: Array<{ value: Theme; label: string; description: string }> = [
    { value: 'light', label: '日间模式', description: '使用明亮的界面配色' },
    { value: 'dark', label: '夜间模式', description: '使用深色的界面配色' },
  ];
  const fontSizeOptions: Array<{ value: FontSize; label: string; description: string }> = [
    { value: 'small', label: '小', description: '更紧凑的文字显示' },
    { value: 'medium', label: '中', description: '推荐的默认大小' },
    { value: 'large', label: '大', description: '更易阅读的文字显示' },
  ];

  return (
    <section className="management-page app-settings-page">
      <div className="page-heading">
        <div><b>应用设置</b><span>调整界面外观与文字显示。</span></div>
      </div>
      <section className="management-card settings-card">
        <div className="card-heading"><Sun size={18} /><div><b>日夜模式</b><p>选择应用的界面配色。</p></div></div>
        <div className="settings-options theme-options">
          {themeOptions.map(option => (
            <button
              className={`settings-option ${props.settings.theme === option.value ? 'selected' : ''}`}
              key={option.value}
              onClick={() => void update({ theme: option.value })}
              disabled={saving}
              aria-pressed={props.settings.theme === option.value}
            >
              {option.value === 'light' ? <Sun size={18} /> : <Moon size={18} />}
              <b>{option.label}</b>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      </section>
      <section className="management-card settings-card">
        <div className="card-heading"><Type size={18} /><div><b>字体大小</b><p>调整应用界面中文字的显示大小。</p></div></div>
        <div className="settings-options font-size-options">
          {fontSizeOptions.map(option => (
            <button
              className={`settings-option ${props.settings.fontSize === option.value ? 'selected' : ''}`}
              key={option.value}
              onClick={() => void update({ fontSize: option.value })}
              disabled={saving}
              aria-pressed={props.settings.fontSize === option.value}
            >
              <b>{option.label}</b>
              <small>{option.description}</small>
            </button>
          ))}
        </div>
      </section>
      {error && <p className="settings-error"><TriangleAlert size={15} />{error}</p>}
    </section>
  );
}
