import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Archive, ChevronDown, ChevronRight, FileCode, FolderPlus, Plus, RefreshCw, Send, Square, Terminal } from 'lucide-react';
import './style.css';

type Message = { role: 'user' | 'assistant' | 'system' | 'error'; text: string };
type FileChange = { path: string; kind: string; diff?: string };
type TimelineItem =
  | { id: string; type: 'message'; role: Message['role']; text: string }
  | { id: string; type: 'command'; status: string; command: string; output: string; exitCode?: number }
  | { id: string; type: 'file_change'; status: string; files: FileChange[] };
type Session = { id: string; title: string; cwd: string; messages?: Message[]; timeline?: TimelineItem[]; updated: number; threadId?: string };
declare global { interface Window { codex: any } }

const messageItem = (message: Message, index: number): TimelineItem => ({ id: `legacy-message-${index}`, type: 'message', ...message });
const timelineOf = (session: Session) => Array.isArray(session.timeline) ? session.timeline : (session.messages || []).map(messageItem);
const normalizeSession = (session: Session): Session => ({ ...session, timeline: timelineOf(session) });
const diffLineClass = (line: string) => line.startsWith('+') && !line.startsWith('+++') ? 'diff-addition' : line.startsWith('-') && !line.startsWith('---') ? 'diff-deletion' : '';

const fresh = (cwd = ''): Session => ({
  id: crypto.randomUUID(), title: '新建对话', cwd,
  timeline: [{ id: 'ready', type: 'message', role: 'system', text: '准备就绪。选择项目文件夹后即可向 Codex 发送消息。' }],
  updated: Date.now(),
});

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session>();
  const [input, setInput] = useState('');
  const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const refreshHistory = async () => {
    const items = await window.codex?.loadHistory();
    if (!items) return;
    const normalized = items.map(normalizeSession);
    setSessions(normalized);
    setActive(current => normalized.find((item: Session) => item.id === current?.id) || normalized[0]);
  };

  useEffect(() => {
    refreshHistory();
    const refreshInterval = window.setInterval(refreshHistory, 60_000);
    const updateSession = (sessionId: string, update: (session: Session) => Session) => {
      setSessions(items => items.map(session => {
        if (session.id !== sessionId) return session;
        const next = update(normalizeSession(session));
        window.codex?.saveSession(next);
        return next;
      }));
      setActive(current => current?.id === sessionId ? update(normalizeSession(current)) : current);
    };
    const appendMessage = (sessionId: string, message: Message) => updateSession(sessionId, session => ({
      ...session,
      timeline: [...timelineOf(session), { id: crypto.randomUUID(), type: 'message', ...message }],
      updated: Date.now(),
    }));
    window.codex?.onData((value: { sessionId: string; stream: string; text: string }) => appendMessage(value.sessionId, { role: value.stream === 'stderr' ? 'error' : 'assistant', text: value.text }));
    window.codex?.onActivity((value: { sessionId: string; activity: Exclude<TimelineItem, { type: 'message' }> }) => updateSession(value.sessionId, session => {
      const timeline = [...timelineOf(session)];
      const index = timeline.findIndex(item => item.id === value.activity.id);
      if (index >= 0) timeline[index] = { ...timeline[index], ...value.activity } as TimelineItem;
      else timeline.push(value.activity);
      return { ...session, timeline, updated: Date.now() };
    }));
    window.codex?.onThread((value: { sessionId: string; threadId: string }) => updateSession(value.sessionId, session => ({ ...session, threadId: value.threadId })));
    window.codex?.onExit((value: { sessionId: string }) => setRunningSessions(current => { const next = new Set(current); next.delete(value.sessionId); return next; }));
    window.codex?.onError((value: { sessionId: string; error: string }) => {
      setRunningSessions(current => { const next = new Set(current); next.delete(value.sessionId); return next; });
      appendMessage(value.sessionId, { role: 'error', text: value.error });
    });
    return () => window.clearInterval(refreshInterval);
  }, []);

  useEffect(() => {
    if (!active) return;
    setSessions(items => [active, ...items.filter(item => item.id !== active.id)]);
    window.codex?.saveSession(active);
  }, [active]);

  const send = async () => {
    if (!input.trim() || !active || runningSessions.has(active.id)) return;
    const text = input.trim();
    setInput('');
    if (!active.cwd) {
      setActive({ ...active, timeline: [...timelineOf(active), { id: crypto.randomUUID(), type: 'message', role: 'system', text: '请先选择项目文件夹。' }] });
      return;
    }
    setActive({ ...active, timeline: [...timelineOf(active), { id: crypto.randomUUID(), type: 'message', role: 'user', text }], title: active.title === '新建对话' ? text.slice(0, 32) : active.title });
    setRunningSessions(current => new Set(current).add(active.id));
    const started = await window.codex.start({ sessionId: active.id, cwd: active.cwd, prompt: text, threadId: active.threadId });
    if (!started) setRunningSessions(current => { const next = new Set(current); next.delete(active.id); return next; });
  };

  const createInFolder = (cwd: string) => setActive(fresh(cwd));
  const createProjectSession = async () => { const cwd = await window.codex.chooseFolder(); if (cwd) createInFolder(cwd); };
  const archive = async (target = active) => {
    if (!target || runningSessions.has(target.id)) return;
    const description = `归档“${target.title}”后，它将从本软件的列表移除。是否继续？`;
    if (!window.confirm(description)) return;
    const archived = await window.codex?.archiveSession(target);
    if (!archived?.ok) { window.alert(`归档失败：${archived?.error || '未知错误'}`); return; }
    const remaining = sessions.filter(session => session.id !== target.id && (!target.threadId || session.threadId !== target.threadId));
    setSessions(remaining);
    setActive(current => current && (current.id === target.id || (target.threadId && current.threadId === target.threadId)) ? remaining[0] : current);
  };
  const archiveProject = async (cwd: string, projectSessions: Session[]) => {
    if (projectSessions.some(session => runningSessions.has(session.id))) return;
    const name = cwd.split(/[/\\]/).filter(Boolean).pop() || cwd;
    if (!window.confirm(`归档项目“${name}”中的全部 ${projectSessions.length} 个对话？它们将从本软件的列表移除。`)) return;
    const archived = await window.codex?.archiveProject(projectSessions);
    if (!archived?.ok) { window.alert(`归档失败：${archived?.error || '未知错误'}`); return; }
    const ids = new Set(projectSessions.map(session => session.id));
    const remaining = sessions.filter(session => !ids.has(session.id));
    setSessions(remaining);
    setActive(current => current && ids.has(current.id) ? remaining[0] : current);
  };

  const groups = useMemo(() => {
    const byPath = new Map<string, Session[]>();
    for (const session of sessions) { const group = byPath.get(session.cwd) || []; group.push(session); byPath.set(session.cwd, group); }
    return [...byPath.entries()].map(([cwd, items]) => ({ cwd, items: items.sort((a, b) => b.updated - a.updated), updated: Math.max(...items.map(item => item.updated)) })).sort((a, b) => b.updated - a.updated);
  }, [sessions]);
  const running = !!active && runningSessions.has(active.id);

  return <div className="app">
    <aside>
      <div className="brand"><Terminal /> Codex GUI</div>
      <div className="sidebar-actions"><button className="icon" onClick={createProjectSession} title="选择项目文件夹并新建对话"><FolderPlus size={18} /></button><button className="icon" onClick={refreshHistory} title="刷新 Codex 历史记录"><RefreshCw size={18} /></button></div>
      <div className="sessions">
        {groups.map(group => {
          const name = group.cwd ? group.cwd.split(/[/\\]/).filter(Boolean).pop() || group.cwd : '未指定项目';
          const collapsed = collapsedGroups.has(group.cwd);
          const projectRunning = group.items.some(session => runningSessions.has(session.id));
          return <section className="session-group" key={group.cwd || '__unassigned__'}>
            <div className="group-heading"><button className="group-toggle" onClick={() => setCollapsedGroups(current => { const next = new Set(current); if (next.has(group.cwd)) next.delete(group.cwd); else next.add(group.cwd); return next; })} title={collapsed ? '展开项目对话' : '折叠项目对话'}>{collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<span>{name}</span><small>{group.items.length}</small></button>{group.cwd && <button className="icon group-new" onClick={() => createInFolder(group.cwd)} title={`在 ${group.cwd} 中新建对话`}><Plus size={16} /></button>}{group.cwd && <button className="icon group-archive" onClick={() => archiveProject(group.cwd, group.items)} title={projectRunning ? '项目中有对话正在执行，无法归档' : '归档该项目全部对话'} disabled={projectRunning}><Archive size={16} /></button>}</div>
            {group.cwd && <small className="group-path" title={group.cwd}>{group.cwd}</small>}
            {!collapsed && <div className="group-sessions">{group.items.map(session => <div className={'session-row ' + (session.id === active?.id ? 'selected' : '')} key={session.id}><button className="session-select" onClick={() => setActive(session)}><span>{session.title}</span></button><button className="icon session-archive" onClick={() => archive(session)} title={runningSessions.has(session.id) ? '正在执行，无法归档' : '归档此对话'} disabled={runningSessions.has(session.id)}><Archive size={15} /></button></div>)}</div>}
          </section>;
        })}
        {!groups.length && <p className="empty-sessions">选择项目文件夹新建对话。</p>}
      </div>
    </aside>
    <main>
      <header><div><b>{active?.title || '未选择对话'}</b><span className="path">{active?.cwd || '未选择项目文件夹'}</span></div><div className="header-actions"><button className="icon" onClick={() => archive()} title={running ? '正在执行，无法归档' : '归档对话'} disabled={!active || running}><Archive size={18} /></button></div></header>
      <section className="messages">
        {active && timelineOf(active).map(item => {
          if (item.type === 'message') return <div className={'message ' + item.role} key={item.id}><label>{item.role === 'user' ? '你' : item.role === 'assistant' ? 'Codex' : item.role === 'error' ? '错误' : '系统提示'}</label><pre>{item.text}</pre></div>;
          if (item.type === 'command') return <details className={'activity command-activity ' + item.status} key={item.id}><summary className="activity-heading"><ChevronRight className="activity-chevron" size={15} /><Terminal size={15} /><span>运行命令</span><small>{item.status === 'running' ? '执行中' : item.exitCode === 0 || item.exitCode === undefined ? '已完成' : `退出码 ${item.exitCode}`}</small></summary><code className="activity-summary">{item.command}</code><pre className="activity-output">{item.output || '没有可显示的输出。'}</pre></details>;
          return <details className={'activity file-activity ' + item.status} key={item.id}><summary className="activity-heading"><ChevronRight className="activity-chevron" size={15} /><FileCode size={15} /><span>文件变更</span><small>{item.status === 'running' ? '处理中' : `${item.files.length} 个文件`}</small></summary><div className="file-list">{item.files.map(file => <section className="file-change" key={file.path}><div><b>{file.kind === 'add' ? '新增' : file.kind === 'delete' ? '删除' : '修改'}</b><code>{file.path}</code></div>{file.diff ? <pre className="activity-output file-diff">{file.diff.split(/\r?\n/).map((line, index) => <span className={diffLineClass(line)} key={index}>{line || ' '}</span>)}</pre> : <p>没有可显示的差异。</p>}</section>)}</div></details>;
        })}
        {!active && <div className="empty-conversation">请从左侧选择或新建一个对话。</div>}
        {running && <div className="message thinking"><label>Codex</label><div className="thinking-status"><span>思考中</span><i /><i /><i /></div></div>}
      </section>
      <footer><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="让 Codex 处理这个项目..." disabled={!active} /><div className="actions"><span>{running ? '思考中...' : '准备就绪'}</span>{running ? <button className="stop" onClick={() => active && window.codex.stop(active.id)}><Square size={16} /> 停止</button> : <button onClick={send} disabled={!active}><Send size={16} /> 发送</button>}</div></footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
