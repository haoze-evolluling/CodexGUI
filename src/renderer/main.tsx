import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { FolderOpen, Plus, Send, Square, Terminal } from 'lucide-react';
import './style.css';

type Message = { role: 'user' | 'assistant' | 'system' | 'error'; text: string };
type Session = { id: string; title: string; cwd: string; messages: Message[]; updated: number; threadId?: string };
declare global { interface Window { codex: any } }

const fresh = (cwd = ''): Session => ({
  id: crypto.randomUUID(), title: 'New session', cwd,
  messages: [{ role: 'system', text: 'Ready. Select a project folder and send a prompt to Codex.' }],
  updated: Date.now(),
});

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [active, setActive] = useState<Session>();
  const [input, setInput] = useState('');
  const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set());

  useEffect(() => {
    window.codex?.listSessions().then((items: Session[]) => { setSessions(items); setActive(items[0] || fresh()); });
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
      updateSession(value.sessionId, session => ({
        ...session,
        messages: [...session.messages, { role: value.stream === 'stderr' ? 'error' : 'assistant', text: value.text }],
        updated: Date.now(),
      }));
    });
    window.codex?.onThread((value: { sessionId: string; threadId: string }) => updateSession(value.sessionId, session => ({ ...session, threadId: value.threadId })));
    window.codex?.onExit((value: { sessionId: string }) => setRunningSessions(current => { const next = new Set(current); next.delete(value.sessionId); return next; }));
    window.codex?.onError((value: { sessionId: string; error: string }) => {
      setRunningSessions(current => { const next = new Set(current); next.delete(value.sessionId); return next; });
      updateSession(value.sessionId, session => ({ ...session, messages: [...session.messages, { role: 'error', text: value.error }] }));
    });
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
      setActive({ ...active, messages: [...active.messages, { role: 'system', text: 'Choose a project folder first.' }] });
      return;
    }
    setActive({ ...active, messages: [...active.messages, { role: 'user', text }], title: active.title === 'New session' ? text.slice(0, 32) : active.title });
    setRunningSessions(current => new Set(current).add(active.id));
    const started = await window.codex.start({ sessionId: active.id, cwd: active.cwd, prompt: text, threadId: active.threadId });
    if (!started) setRunningSessions(current => { const next = new Set(current); next.delete(active.id); return next; });
  };

  const folder = async () => {
    const cwd = await window.codex.chooseFolder();
    if (cwd) setActive(current => ({ ...((current || fresh()) as Session), cwd }));
  };

  const running = !!active && runningSessions.has(active.id);

  return <div className="app">
    <aside>
      <div className="brand"><Terminal /> Codex GUI</div>
      <button className="new" onClick={() => setActive(fresh())}><Plus size={16} /> New session</button>
      <div className="sessions">{sessions.map(session =>
        <button className={session.id === active?.id ? 'selected' : ''} onClick={() => setActive(session)} key={session.id}>
          <span>{session.title}</span><small>{session.cwd || 'No folder selected'}</small>
        </button>)}</div>
    </aside>
    <main>
      <header><div><b>{active?.title || 'Codex session'}</b><span className="path">{active?.cwd || 'No project folder'}</span></div><button className="icon" onClick={folder} title="Choose project folder"><FolderOpen size={18} /></button></header>
      <section className="messages">
        {active?.messages.map((message, index) => <div className={'message ' + message.role} key={index}><label>{message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Codex' : message.role === 'error' ? 'Error' : 'System'}</label><pre>{message.text}</pre></div>)}
        {running && <div className="message thinking"><label>Codex</label><div className="thinking-status"><span>Thinking</span><i /><i /><i /></div></div>}
      </section>
      <footer>
        <textarea value={input} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder="Ask Codex to work on this project..." />
        <div className="actions"><span>{running ? 'Thinking...' : 'Ready'}</span>{running ? <button className="stop" onClick={() => active && window.codex.stop(active.id)}><Square size={16} /> Stop</button> : <button onClick={send}><Send size={16} /> Send</button>}</div>
      </footer>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(<App />);
