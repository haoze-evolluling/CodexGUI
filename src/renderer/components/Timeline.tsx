import { useLayoutEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { timelineOf } from '../session-model';
import type { Session } from '../types';
import { ActivityItem } from './ActivityItem';

const roleLabel = {
  user: '你',
  assistant: 'Codex',
  error: '错误',
  system: '系统提示',
} as const;

export function Timeline({ active, running, onAnswer }: { active?: Session; running: boolean; onAnswer?(activity: import('../types').UserInputActivity, answers: Record<string, { answers: string[] }>): void }) {
  const messagesRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [active?.id]);

  return (
    <section className="messages" ref={messagesRef}>
      {active && timelineOf(active).map(item => item.type === 'message' ? (
        <div className={`message ${item.role}`} key={item.id}>
          <label>{roleLabel[item.role]}</label>
          {item.role === 'assistant' ? (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
            </div>
          ) : <pre>{item.text}</pre>}
        </div>
      ) : <ActivityItem activity={item} key={item.id} onAnswer={onAnswer} />)}
      {!active && <div className="empty-conversation">请从左侧选择或新建一个对话。</div>}
      {running && (
        <div className="message thinking">
          <label>Codex</label>
          <div className="thinking-status"><span>思考中</span><i /><i /><i /></div>
        </div>
      )}
    </section>
  );
}
