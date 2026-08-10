import { Check, CheckCircle2, Eye, EyeOff, Plus, Save, Settings, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { CodexProviderInput, CodexProviderState, ProviderStateResult } from '../types';

export type SettingsPageProps = {
  providerState?: CodexProviderState;
  onProviderSave(input: CodexProviderInput): Promise<ProviderStateResult>;
  onProviderActivate(id: string): Promise<ProviderStateResult>;
  onProviderDelete(id: string): Promise<ProviderStateResult>;
};

export function SettingsPage(props: SettingsPageProps) {
  const [providerId, setProviderId] = useState<string>();
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [effort, setEffort] = useState('medium');
  const [keyVisible, setKeyVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reset = () => { setProviderId(undefined); setName(''); setBaseUrl(''); setApiKey(''); setModel(''); setEffort('medium'); setKeyVisible(false); setError(''); };
  const edit = (id: string, source = props.providerState) => {
    const provider = source?.providers.find(item => item.id === id);
    if (!provider) return;
    setProviderId(provider.id); setName(provider.name); setBaseUrl(provider.baseUrl); setApiKey(''); setModel(provider.model); setEffort(provider.reasoningEffort || 'medium'); setKeyVisible(false); setError('');
  };
  useEffect(() => { if (props.providerState?.activeId && !providerId) edit(props.providerState.activeId); }, [props.providerState?.activeId]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const result = await props.onProviderSave({ ...(providerId ? { id: providerId } : {}), name, baseUrl, apiKey, model, reasoningEffort: effort });
      if (!result.ok) setError(result.error); else { setApiKey(''); if (!providerId) { const saved = result.state.providers.find(item => item.name === name.trim()); if (saved) setProviderId(saved.id); } }
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } finally { setSaving(false); }
  };
  const activate = async (id: string) => { setSaving(true); setError(''); try { const result = await props.onProviderActivate(id); if (!result.ok) setError(result.error); else edit(id, result.state); } finally { setSaving(false); } };
  const remove = async (id: string) => { if (!window.confirm('确定删除这个模型提供商吗？')) return; setSaving(true); setError(''); try { const result = await props.onProviderDelete(id); if (!result.ok) setError(result.error); else if (providerId === id) reset(); } finally { setSaving(false); } };

  return <section className="management-page"><div className="page-heading"><div><b>模型提供商</b><span>配置并切换 Codex 使用的自定义模型服务。</span></div></div><section className="management-card provider-card"><div className="card-heading"><Settings size={18} /><div><b>自定义提供商</b><p>API Key 使用系统安全存储；切换提供商会重启 Codex 服务。</p></div></div><div className="provider-layout"><div className="provider-list">{props.providerState?.providers.map(provider => { const active = provider.id === props.providerState?.activeId; return <div className={`provider-item ${active ? 'selected' : ''}`} key={provider.id}><button className="provider-item-main" onClick={() => edit(provider.id)}><span className="provider-name">{active && <CheckCircle2 size={15} />}{provider.name}</span><span className="provider-meta">{provider.model} · {provider.baseUrl}</span><small className={provider.hasApiKey ? 'configured' : 'missing'}>{provider.hasApiKey ? 'API Key 已配置' : '缺少 API Key'}</small></button><div className="provider-item-actions">{!active && <button className="icon" onClick={() => void activate(provider.id)} disabled={saving} title="切换提供商"><Check size={16} /></button>}<button className="icon" onClick={() => void remove(provider.id)} disabled={saving || active} title="删除提供商"><Trash2 size={16} /></button></div></div>; })}{!props.providerState?.providers.length && <p className="empty-state">尚未保存提供商。</p>}<button className="new-provider" onClick={reset} disabled={saving}><Plus size={15} />新建提供商</button></div><div className="provider-form"><b>{providerId ? '编辑提供商' : '新建提供商'}</b><label>提供商名称<input value={name} onChange={event => setName(event.target.value)} /></label><label>请求地址<input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.example.com" spellCheck={false} /></label><label>API Key<div className="secret-field"><input type={keyVisible ? 'text' : 'password'} value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={providerId ? '留空以保留当前 Key' : '输入 API Key'} spellCheck={false} /><button className="icon" onClick={() => setKeyVisible(value => !value)} title={keyVisible ? '隐藏 API Key' : '显示 API Key'}>{keyVisible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label><label>默认模型<input value={model} onChange={event => setModel(event.target.value)} placeholder="例如：gpt-5" spellCheck={false} /></label><label>默认推理强度<select value={effort} onChange={event => setEffort(event.target.value)}><option value="minimal">minimal</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="xhigh">xhigh</option></select></label>{error && <p className="form-error"><TriangleAlert size={15} />{error}</p>}<button className="primary-button" onClick={() => void save()} disabled={saving || !name.trim() || !baseUrl.trim() || !model.trim()}><Save size={15} />{saving ? '应用中…' : '应用提供商'}</button></div></div></section></section>;
}
