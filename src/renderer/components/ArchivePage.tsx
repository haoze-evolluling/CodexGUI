import { Archive, RefreshCw, RotateCcw, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Session } from '../types';

function projectName(cwd: string) {
  return cwd.split(/[\\/]/).filter(Boolean).pop() || cwd;
}

function formatTime(value?: number) {
  if (!value) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(value);
}

export type ArchivePageProps = {
  sessions: Session[];
  onRefresh(): Promise<void> | void;
  onClear(): void;
  onRemove(session: Session): void;
  onRestore(session: Session): void;
};

export function ArchivePage(props: ArchivePageProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return props.sessions;
    return props.sessions.filter(session => `${session.title} ${session.cwd} ${projectName(session.cwd)} ${session.model || ''}`.toLowerCase().includes(normalized));
  }, [props.sessions, query]);

  const confirmClear = () => {
    if (props.sessions.length && window.confirm(`确定清空全部 ${props.sessions.length} 条归档记录吗？此操作不可撤销。`)) props.onClear();
  };

  return (
    <section className="management-page">
      <div className="page-heading">
        <div><b>对话归档</b><span>管理已归档的 Codex 对话记录，不提供交互入口。</span></div>
        <button className="icon" onClick={props.onRefresh} title="刷新归档列表" aria-label="刷新归档列表"><RefreshCw size={18} /></button>
      </div>
      <section className="management-card">
        <div className="card-heading"><Search size={18} /><div><b>搜索归档</b><p>可按标题、项目路径或模型过滤。</p></div></div>
        <input className="search-input" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索归档会话" spellCheck={false} />
      </section>
      <section className="management-card archive-list-card">
        <div className="card-heading"><Archive size={18} /><div><b>归档列表</b><p>共 {filtered.length} 条匹配记录。</p></div><button className="danger-button" onClick={confirmClear} disabled={!props.sessions.length}><Trash2 size={15} />全部清除</button></div>
        {!filtered.length ? <div className="empty-state">没有匹配的归档会话。</div> : <div className="archive-list">{filtered.map(session => (
          <article className="archive-item" key={`${session.id}:${session.threadId || ''}`}>
            <div className="archive-item-main"><b>{session.title || '未命名对话'}</b><span>{projectName(session.cwd) || '未指定项目'}</span><small title={session.cwd}>{session.cwd || '路径不可用'}</small><div className="archive-meta"><span>{formatTime(session.archivedAt || session.updated)}</span>{session.model && <span>{session.model}</span>}</div></div>
            <div className="archive-actions"><button onClick={() => props.onRestore(session)} disabled={!session.threadId}><RotateCcw size={15} />恢复</button><button className="danger-button" onClick={() => { if (window.confirm(`确定移除“${session.title || '未命名对话'}”吗？`)) props.onRemove(session); }} disabled={!session.threadId}><Trash2 size={15} />移除</button></div>
          </article>
        ))}</div>}
      </section>
    </section>
  );
}
