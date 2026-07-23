import { type KeyboardEvent, type MouseEvent, type PointerEvent, useState } from 'react';
import { Archive, ChevronDown, ChevronRight, FolderPlus, LoaderCircle, Plus, RefreshCw, Settings, Terminal } from 'lucide-react';
import { projectName } from '../session-model';
import type { Session, SessionGroup } from '../types';

type SidebarProps = {
  active?: Session;
  collapsedGroups: Set<string>;
  groups: SessionGroup[];
  runningSessions: Set<string>;
  onArchiveProject(cwd: string, sessions: Session[]): void;
  onArchiveSession(session: Session): void;
  onCreateInFolder(cwd: string): void;
  onCreateProject(): void;
  onProjectContextMenu(event: MouseEvent, cwd: string, sessions: Session[]): void;
  onRefresh(): void;
  onSelect(session: Session): void;
  onSettings(): void;
  onToggleGroup(cwd: string): void;
};

export function Sidebar(props: SidebarProps) {
  const minWidth = 210;
  const maxWidth = 480;
  const [width, setWidth] = useState(() => window.innerWidth <= 700 ? minWidth : 300);
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
          const projectRunning = group.items.some(session => props.runningSessions.has(session.id));
          return (
            <section className="session-group" key={group.cwd || '__unassigned__'}>
              <div className="group-heading">
                <button
                  className="group-toggle"
                  onClick={() => props.onToggleGroup(group.cwd)}
                  title={collapsed ? '展开项目对话' : '折叠项目对话'}
                >
                  {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
                  <span onContextMenu={event => group.cwd && props.onProjectContextMenu(event, group.cwd, group.items)}>{projectName(group.cwd)}</span>
                  <small>{group.items.length}</small>
                </button>
                {group.cwd && (
                  <button className="icon group-new" onClick={() => props.onCreateInFolder(group.cwd)} title={`在 ${group.cwd} 中新建对话`}>
                    <Plus size={16} />
                  </button>
                )}
                {group.cwd && group.items.length > 0 && (
                  <button
                    className="icon group-archive"
                    onClick={() => props.onArchiveProject(group.cwd, group.items)}
                    title={projectRunning ? '项目中有对话正在执行，无法归档' : '归档该项目全部对话'}
                    disabled={projectRunning}
                  >
                    <Archive size={16} />
                  </button>
                )}
              </div>
              {group.cwd && <small className="group-path" title={group.cwd}>{group.cwd}</small>}
              {!collapsed && (
                <div className="group-sessions">
                  {group.items.map(session => (
                    <div className={`session-row ${session.id === props.active?.id ? 'selected' : ''}`} key={session.id}>
                      <button className="session-select" onClick={() => props.onSelect(session)}>
                        <span>{session.title}</span>
                      </button>
                      {props.runningSessions.has(session.id) && <LoaderCircle className="session-running" size={15} aria-label="正在运行" />}
                      <button
                        className="icon session-archive"
                        onClick={() => props.onArchiveSession(session)}
                        title={props.runningSessions.has(session.id) ? '正在执行，无法归档' : '归档此对话'}
                        disabled={props.runningSessions.has(session.id)}
                      >
                        <Archive size={15} />
                      </button>
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
