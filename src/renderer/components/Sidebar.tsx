import { type KeyboardEvent, type MouseEvent, type PointerEvent, useState } from 'react';
import { ChevronDown, ChevronRight, FolderPlus, LoaderCircle, Plus, RefreshCw, Settings, Terminal } from 'lucide-react';
import { projectName } from '../session-model';
import type { Session, SessionGroup } from '../types';

type SidebarProps = {
  active?: Session;
  collapsedGroups: Set<string>;
  groups: SessionGroup[];
  runningSessions: Set<string>;
  onCreateInFolder(cwd: string): void;
  onCreateProject(): void;
  onProjectContextMenu(event: MouseEvent, cwd: string, sessions: Session[]): void;
  onRefresh(): void;
  onRenameSession(session: Session, title: string): void;
  onSessionContextMenu(event: MouseEvent, session: Session, startRenaming: () => void): void;
  onSelect(session: Session): void;
  onSettings(): void;
  onToggleGroup(cwd: string): void;
};

export function Sidebar(props: SidebarProps) {
  const minWidth = 210;
  const maxWidth = 480;
  const [width, setWidth] = useState(() => window.innerWidth <= 700 ? minWidth : 300);
  const [renamingSessionId, setRenamingSessionId] = useState<string>();
  const [titleDraft, setTitleDraft] = useState('');
  const updateWidth = (value: number) => setWidth(Math.min(maxWidth, Math.max(minWidth, value)));
  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const resize = (moveEvent: globalThis.PointerEvent) => updateWidth(startWidth + moveEvent.clientX - startX);
    const stopResize = () => {
      window.removeEventListener('pointermove', resize);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
    };
    window.addEventListener('pointermove', resize);
    window.addEventListener('pointerup', stopResize, { once: true });
    window.addEventListener('pointercancel', stopResize, { once: true });
  };
  const resizeWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    updateWidth(width + (event.key === 'ArrowLeft' ? -16 : 16));
  };
  const startRenaming = (session: Session) => {
    setRenamingSessionId(session.id);
    setTitleDraft(session.title);
  };
  const finishRenaming = (session: Session) => {
    const title = titleDraft.trim();
    if (title && title !== session.title) props.onRenameSession(session, title);
    setRenamingSessionId(undefined);
  };

  return (
    <div className="sidebar-shell" style={{ width }}>
      <aside>
        <div className="brand"><Terminal /> Codex GUI</div>
        <div className="sidebar-actions">
          <button className="icon" onClick={props.onCreateProject} title="选择项目文件夹并新建对话">
            <FolderPlus size={18} />
          </button>
          <button className="icon" onClick={props.onRefresh} title="刷新 Codex 历史记录">
            <RefreshCw size={18} />
          </button>
        </div>
        <div className="sessions">
        {props.groups.map(group => {
          const collapsed = props.collapsedGroups.has(group.cwd);
          return (
            <section className="session-group" key={group.cwd || '__unassigned__'}>
              <div className="group-heading" onContextMenu={event => group.cwd && props.onProjectContextMenu(event, group.cwd, group.items)}>
                <button
                  className="group-toggle"
                  onClick={() => props.onToggleGroup(group.cwd)}
                  title={collapsed ? '展开项目对话' : '折叠项目对话'}
                >
                  {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  <span>{projectName(group.cwd)}</span>
                  <small>{group.items.length}</small>
                </button>
                {group.cwd && (
                  <button className="icon group-new" onClick={() => props.onCreateInFolder(group.cwd)} title={`在 ${group.cwd} 中新建对话`}>
                    <Plus size={16} />
                  </button>
                )}
              </div>
              {group.cwd && <small className="group-path" title={group.cwd}>{group.cwd}</small>}
              {!collapsed && (
                <div className="group-sessions">
                  {group.items.map(session => (
                    <div
                      className={`session-row ${session.id === props.active?.id ? 'selected' : ''}`}
                      key={session.id}
                      onContextMenu={event => props.onSessionContextMenu(event, session, () => startRenaming(session))}
                    >
                      {renamingSessionId === session.id ? (
                        <input
                          autoFocus
                          className="session-title-input"
                          value={titleDraft}
                          onChange={event => setTitleDraft(event.target.value)}
                          onBlur={() => finishRenaming(session)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') finishRenaming(session);
                            if (event.key === 'Escape') setRenamingSessionId(undefined);
                          }}
                          aria-label="对话名称"
                        />
                      ) : (
                        <button className="session-select" onClick={() => props.onSelect(session)}>
                          <span>{session.title}</span>
                        </button>
                      )}
                      {props.runningSessions.has(session.id) && <LoaderCircle className="session-running" size={15} aria-label="正在运行" />}
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        {!props.groups.length && <p className="empty-sessions">选择项目文件夹新建对话。</p>}
        </div>
        <div className="sidebar-footer">
          <button onClick={props.onSettings}><Settings size={17} /><span>设置</span></button>
        </div>
      </aside>
      <div
        className="sidebar-resizer"
        role="separator"
        aria-label="调整侧边栏宽度"
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        tabIndex={0}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={startResize}
      />
    </div>
  );
}
