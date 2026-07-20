import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Archive, ChevronDown, ChevronRight, FolderPlus, Plus, RefreshCw, Send, Square, Terminal } from 'lucide-react';
import './style.css';

type Message = { role: 'user' | 'assistant' | 'system' | 'error'; text: string };
type Session = { id: string; title: string; cwd: string; messages: Message[]; updated: number; threadId?: string };
declare global { interface Window { codex: any } }

const fresh = (cwd = ''): Session => ({
  id: crypto.randomUUID(), title: '新建对话', cwd,
  messages: [{ role: 'system', text: '准备就绪。选择项目文件夹后即可向 Codex 发送消息。' }],
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
    setSessions(items);
    setActive(current => items.find((item: Session) => item.id === current?.id) || items[0]);
  };

  useEffect(() => {
    refreshHistory();
    const refreshInterval = window.setInterval(refreshHistory, 60_000);
    const updateSession = (sessionId: string, update: (session: Session) => Session) => {
      setSessions(items => items.map(session => {
        if (session.id !== sessionId) return session;
        const next = update(session);
        window.codex?.saveSession(next);
        return next;
      }));
      setActive(current => current?.id === sessionId ? update(current) : current);
    };
    window.codex?.onData((value: { sessionId: string; stream: string; text: string }) => {
      updateSession(value.sessionId, session => ({ ...session, messages: [...session.messages, { role: value.stream === 'stderr' ? 'error' : 'assistant', text: value.text }], updated: Date.now() }));
    });
    window.codex?.onThread((value: { sessionId: string; threadId: string }) => updateSession(value.sessionId, session => ({ ...session, threadId: value.threadId })));
    window.codex?.onExit((value: { sessionId: string }) => setRunningSessions(current => { const next = new Set(current); next.delete(value.sessionId); return next; }));
    window.codex?.onError((value: { sessionId: string; error: string }) => {
      setRunningSessions(current => { const next = new Set(current); next.delete(value.sessionId); return next; });
      updateSession(value.sessionId, session => ({ ...session, messages: [...session.messages, { role: 'error', text: value.error }] }));
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
      setActive({ ...active, messages: [...active.messages, { role: 'system', text: '请先选择项目文件夹。' }] });
      return;
    }
    setActive({ ...active, messages: [...active.messages, { role: 'user', text }], title: active.title === '新建对话' ? text.slice(0, 32) : active.title });
    setRunningSessions(current => new Set(current).add(active.id));
    const started = await window.codex.start({ sessionId: active.id, cwd: active.cwd, prompt: text, threadId: active.threadId });
    if (!started) setRunningSessions(current => { const next = new Set(current); next.delete(active.id); return next; });
  };

  const createInFolder = (cwd: string) => setActive(fresh(cwd));
  const createProjectSession = async () => { const cwd = await window.codex.chooseFolder(); if (cwd) createInFolder(cwd); };
  const archive = async () => {
    if (!active || running) return;
    const description = active.threadId
      ? `归档“${active.title}”后，它将从列表移除，可在 Codex 中恢复。是否继续？`
      : `“${active.title}”尚未发送到 Codex，将仅从本软件移除。是否继续？`;
    if (!window.confirm(description)) return;
    const archived = await window.codex?.archiveSession(active);
    if (!archived?.ok) { window.alert(`归档失败：${archived?.error || '未知错误'}`); return; }
    const remaining = sessions.filter(session =>
      session.id !== active.id &&
      (!active.threadId || session.threadId !== active.threadId),
    );
    setSessions(remaining);
    setActive(remaining[0]);
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
      <div className="sidebar-actions">
        <button className="icon" onClick={createProjectSession} title="选择项目文件夹并新建对话"><FolderPlus size={18} /></button>
        <button className="icon" onClick={refreshHistory} title="刷新 Codex 历史记录"><RefreshCw size={18} /></button>
      </div>
      <div className="sessions">
        {groups.map(group => {
          const name = group.cwd ? group.cwd.split(/[/\\]/).filter(Boolean).pop() || group.cwd : '未指定项目';
          const collapsed = collapsedGroups.has(group.cwd);
          return <section className="session-group" key={group.cwd || '__unassigned__'}>
            <div className="group-heading">
              <button className="group-toggle" onClick={() => setCollapsedGroups(current => { const next = new Set(current); if (next.has(group.cwd)) next.delete(group.cwd); else next.add(group.cwd); return next; })} title={collapsed ? '展开项目对话' : '折叠项目对话'}>
                {collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}<span>{name}</span><small>{group.items.length}</small>
              </button>
              {group.cwd && <button className="icon group-new" onClick={() => createInFolder(group.cwd)} title={`在 ${group.cwd} 中新建对话`}><Plus size={16} /></button>}
            </div>
            {group.cwd && <small className="group-path" title={group.cwd}>{group.cwd}</small>}
            {!collapsed && <div className="group-sessions">{group.items.map(session => <button className={session.id === active?.id ? 'selected' : ''} onClick={() => setActive(session)} key={session.id}><span>{session.title}</span></button>)}</div>}
          </section>;
        })}
        {!groups.length && <p className="empty-sessions">选择项目文件夹新建对话。</p>}
      </div>
    </aside>
    <main>
      <header><div><b>{active?.title || '未选择对话'}</b><span className="path">{active?.cwd || '未选择项目文件夹'}</span></div><div className="header-actions"><button className="icon" onClick={archive} title={running ? '正在执行，无法归档' : '归档对话'} disabled={!active || running}><Archive size={18} /></button></div></header>
      <section className="messages">
        {active?.messages.map((message, index) => <div className={'message ' + message.role} key={index}><label>{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Codex' : message.role === 'error' ? '错误' : '系统提示'}</label><pre>{message.text}</pre></div>)}
        {!active && <div className="empty-conversation">请从左侧选择或新建一个对话。</div>}
        {running && <div className="message thinking"><label>Codex</label><div className="thinking-status"><span>思考中</span><i /><i /><i /></div></div>}
      </section>
      <footer><textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="让 Codex 处理这个项目..." disabled={!active} /><div className="actions"><span>{running ? '思考中...' : '准备就绪'}</span>{running ? <button className="stop" onClick={() => active && window.codex.stop(active.id)}><Square size={16} /> 停止</button> : <button onClick={send} disabled={!active}><Send size={16} /> 发送</button>}</div></footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
