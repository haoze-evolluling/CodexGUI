import { Archive, RefreshCw, RotateCcw, Search, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { projectName } from '../session-model';
import type { Session } from '../types';

function formatTime(value?: number) {
  if (!value) return '未知时间';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return '未知时间';
  }
}

type ArchivePageProps = {
  sessions: Session[];
  onClose(): void;
  onRefresh(): void;
  onRemove(session: Session): void;
  onRestore(session: Session): void;
};

export function ArchivePage(props: ArchivePageProps) {
  const [query, setQuery] = useState('');
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return props.sessions;
    return props.sessions.filter(session => {
      const haystack = `${session.title} ${session.cwd} ${projectName(session.cwd)} ${session.model || ''}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [props.sessions, query]);

  return (
    <main className="settings-page archive-page">
      <header className="settings-page-header">
        <div>
          <b>归档会话</b>
          <span className="path">查看、恢复或彻底移除已归档的对话</span>
        </div>
        <div className="header-actions">
          <button className="icon" onClick={props.onRefresh} title="刷新归档列表" aria-label="刷新归档列表">
            <RefreshCw size={18} />
          </button>
          <button className="icon" onClick={props.onClose} title="返回对话" aria-label="返回对话">
            <X size={18} />
          </button>
        </div>
      </header>

      <div className="settings-page-body">
        <section className="settings-section">
          <div className="settings-section-title">
            <Search size={18} />
            <div>
              <b>搜索归档</b>
              <p className="settings-hint">可按标题、项目路径或模型过滤。</p>
            </div>
          </div>
          <input
            className="settings-number-input archive-search-input"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="搜索归档会话"
            spellCheck={false}
          />
        </section>

        <section className="settings-section archive-list-section">
          <div className="settings-section-title">
            <Archive size={18} />
            <div>
              <b>归档列表</b>
              <p className="settings-hint">共 {filtered.length} 条记录。</p>
            </div>
          </div>

          {!filtered.length && (
            <div className="archive-empty">没有匹配的归档会话。</div>
          )}

          <div className="archive-list">
            {filtered.map(session => (
              <article className="archive-item" key={`${session.id}:${session.threadId || ''}`}>
                <div className="archive-item-main">
                  <b>{session.title || '未命名对话'}</b>
                  <span>{projectName(session.cwd) || '未指定项目'}</span>
                  <small title={session.cwd}>{session.cwd || '路径不可用'}</small>
                  <div className="archive-item-meta">
                    <span>{formatTime(session.archivedAt || session.updated)}</span>
                    {session.model && <span>{session.model}</span>}
                  </div>
                </div>
                <div className="archive-item-actions">
                  <button onClick={() => props.onRestore(session)} title="恢复会话">
                    <RotateCcw size={15} />
                    恢复
                  </button>
                  <button className="danger" onClick={() => props.onRemove(session)} title="彻底移除">
                    <Trash2 size={15} />
                    移除
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
