import { type ClipboardEvent, type MouseEvent, useLayoutEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { timelineOf } from '../session-model';
import type { PlanDecisionActivity, Session } from '../types';
import { ActivityItem } from './ActivityItem';
import { AttachmentTokens } from './AttachmentTokens';

const roleLabel = {
  user: '你',
  assistant: 'Codex',
  error: '错误',
  system: '系统提示',
} as const;

export function Timeline({ active, running, onAnswer, onPlanChoice, onSelectedTextContextMenu }: { active?: Session; running: boolean; onAnswer?(activity: import('../types').UserInputActivity, answers: Record<string, { answers: string[] }>): void; onPlanChoice?(activity: PlanDecisionActivity, choice: NonNullable<PlanDecisionActivity['choice']>): void; onSelectedTextContextMenu?(event: MouseEvent, text: string): void }) {
  const messagesRef = useRef<HTMLElement>(null);
  const items = active ? timelineOf(active) : [];

  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (messages) messages.scrollTop = messages.scrollHeight;
  }, [active?.id, items.length]);

  return (
    <section
      className="messages"
      ref={messagesRef}
      onContextMenu={event => {
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (!text || !selection?.rangeCount || !messagesRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
        event.preventDefault();
        onSelectedTextContextMenu?.(event, text);
      }}
      onCopy={(event: ClipboardEvent<HTMLElement>) => {
        const selection = window.getSelection();
        const text = selection?.toString();
        if (!text || !selection?.rangeCount || !messagesRef.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
        event.preventDefault();
        event.clipboardData.setData('text/plain', text);
      }}
    >
      {items.map(item => item.type === 'message' ? (
        <div className={`message ${item.role}`} key={item.id}>
          <label>{roleLabel[item.role]}</label>
          {!!item.attachments?.length && <AttachmentTokens attachments={item.attachments} />}
          {item.role === 'assistant' || item.role === 'user' ? (
            <div className="markdown-body">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text}</ReactMarkdown>
            </div>
          ) : item.text ? <pre>{item.text}</pre> : null}
        </div>
      ) : <ActivityItem activity={item} key={item.id} onAnswer={onAnswer} onPlanChoice={onPlanChoice} />)}
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
