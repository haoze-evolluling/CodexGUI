import { ChevronDown, ChevronUp } from 'lucide-react';
import { lazy, memo, Suspense, type ClipboardEvent, type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { isContinuePrompt } from '../continue-prompt';
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

const MarkdownMessage = lazy(() => import('./MarkdownMessage').then(module => ({ default: module.MarkdownMessage })));

const MessageItem = memo(function MessageItem({ item }: { item: Extract<import('../types').TimelineItem, { type: 'message' }> }) {
  return (
    <div className={`message ${item.role}`}>
      <label>{roleLabel[item.role]}</label>
      {!!item.attachments?.length && <AttachmentTokens attachments={item.attachments} />}
      {item.role === 'assistant' ? (
        <Suspense fallback={<div className="markdown-body markdown-loading">加载中…</div>}>
          <MarkdownMessage text={item.text} />
        </Suspense>
      ) : item.role === 'user' ? (
        isContinuePrompt(item.text) ? <div className="user-message-text"><span className="command-token">/continue</span></div> : (
          <Suspense fallback={<div className="markdown-body markdown-loading">加载中…</div>}>
            <MarkdownMessage text={item.text} className="user-message-markdown" />
          </Suspense>
        )
      ) : item.text ? <pre>{item.text}</pre> : null}
    </div>
  );
});

export function Timeline({
  active,
  refreshing,
  running,
  onAnswer,
  onOpenPath,
  onOpenInVsCode,
  onPlanChoice,
  onLoadDiff,
  onSelectedTextContextMenu,
}: {
  active?: Session;
  refreshing?: boolean;
  running: boolean;
  onAnswer?(activity: import('../types').UserInputActivity, answers: Record<string, { answers: string[] }>): void;
  onOpenPath?(path: string): void;
  onOpenInVsCode?(path: string): void;
  onPlanChoice?(activity: PlanDecisionActivity, choice: NonNullable<PlanDecisionActivity['choice']>): void;
  onLoadDiff?(activityId: string, file: import('../types').FileChange): void;
  onSelectedTextContextMenu?(event: MouseEvent, text: string): void;
}) {
  const messagesRef = useRef<HTMLElement | null>(null);
  const followOutputRef = useRef(true);
  const previousSessionIdRef = useRef<string | undefined>(undefined);
  const [visibleStart, setVisibleStart] = useState(0);
  const items = active ? timelineOf(active) : [];
  const renderedItems = items.slice(visibleStart);

  useLayoutEffect(() => {
    followOutputRef.current = true;
    setVisibleStart(Math.max(0, items.length - 120));
  }, [active?.id]);

  useEffect(() => {
    if (followOutputRef.current) setVisibleStart(Math.max(0, items.length - 120));
  }, [items.length]);

  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (!messages) return;
    const sessionChanged = previousSessionIdRef.current !== active?.id;
    previousSessionIdRef.current = active?.id;
    if (!sessionChanged && !followOutputRef.current) return;
    messages.scrollTop = messages.scrollHeight;
  }, [active?.id, items, running, visibleStart]);

  return (
    <div className="timeline-panel">
      <section
        className={`messages ${refreshing ? 'messages-refreshing' : ''}`}
        ref={messagesRef}
        onScroll={event => {
          const messages = event.currentTarget;
          if (messages.scrollTop < 80 && visibleStart > 0) setVisibleStart(current => Math.max(0, current - 120));
          const distanceFromBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
          followOutputRef.current = distanceFromBottom <= 48;
        }}
        onContextMenu={event => {
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
          const text = selection?.toString().trim();
          if (!text || !range || !messagesRef.current || !range.intersectsNode(messagesRef.current)) return;
          event.preventDefault();
          onSelectedTextContextMenu?.(event, text);
        }}
        onCopy={(event: ClipboardEvent<HTMLElement>) => {
          const selection = window.getSelection();
          const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
          const text = selection?.toString();
          if (!text || !range || !messagesRef.current || !range.intersectsNode(messagesRef.current)) return;
          event.preventDefault();
          event.clipboardData.clearData();
          event.clipboardData.setData('text/plain', text);
        }}
      >
        {visibleStart > 0 && <button className="timeline-load-earlier" type="button" onClick={() => setVisibleStart(current => Math.max(0, current - 120))}>加载更早消息</button>}
        {renderedItems.map(item => item.type === 'message' ? (
          <MessageItem item={item} key={item.id} />
        ) : (
          <ActivityItem
            activity={item}
            cwd={active?.cwd}
            key={item.id}
            onAnswer={onAnswer}
            onOpenPath={onOpenPath}
            onOpenInVsCode={onOpenInVsCode}
            onPlanChoice={onPlanChoice}
            onLoadDiff={onLoadDiff}
          />
        ))}
        {!active && <div className="empty-conversation">请从左侧选择或新建一个对话。</div>}
        {running && (
          <div className="message thinking">
            <label>Codex</label>
            <div className="thinking-status"><span>思考中</span><i /><i /><i /></div>
          </div>
        )}
      </section>
      <div className="timeline-navigation" aria-label="对话滚动导航">
        <button
          type="button"
          title="滚动到最上面"
          aria-label="滚动到最上面"
          onClick={() => {
            followOutputRef.current = false;
            messagesRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          }}
        ><ChevronUp size={18} /></button>
        <button
          type="button"
          title="滚动到最下面"
          aria-label="滚动到最下面"
          onClick={() => {
            followOutputRef.current = true;
            const messages = messagesRef.current;
            if (!messages) return;
            messages.scrollTop = messages.scrollHeight;
          }}
        ><ChevronDown size={18} /></button>
      </div>
    </div>
  );
}
