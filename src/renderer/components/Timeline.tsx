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

const MessageItem = memo(function MessageItem({ item, userName }: { item: Extract<import('../types').TimelineItem, { type: 'message' }>; userName: string }) {
  return (
    <div className={`message ${item.role}`} role="article" aria-label={item.role === 'user' ? userName || roleLabel[item.role] : roleLabel[item.role]}>
      {item.role === 'user' && userName && <div className="message-author">{userName}</div>}
      <div className={item.role === 'user' ? 'user-message-bubble' : 'message-body'}>
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
  onPlanChoice?(activity: PlanDecisionActivity, choice: NonNullable<PlanDecisionActivity['choice']>): Promise<boolean>;
  onLoadDiff?(activityId: string, file: import('../types').FileChange): void;
  onSelectedTextContextMenu?(event: MouseEvent, text: string): void;
}) {
  const messagesRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const followOutputRef = useRef(true);
  const pointerScrollingRef = useRef(false);
  const previousScrollTopRef = useRef(0);
  const prependSnapshotRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const pendingTargetRef = useRef<'top' | 'bottom' | null>(null);
  const [visibleStart, setVisibleStart] = useState(0);
  const [userName, setUserName] = useState('');
  const items = active ? timelineOf(active) : [];
  const renderedItems = items.slice(visibleStart);

  useEffect(() => {
    let current = true;
    window.codex.getUserName().then(name => {
      if (current) setUserName(name.trim());
    }).catch(() => undefined);
    return () => { current = false; };
  }, []);

  useLayoutEffect(() => {
    followOutputRef.current = true;
    pendingTargetRef.current = 'bottom';
    prependSnapshotRef.current = null;
    setVisibleStart(Math.max(0, items.length - 120));
  }, [active?.id]);

  useEffect(() => {
    if (followOutputRef.current) setVisibleStart(Math.max(0, items.length - 120));
  }, [items.length]);

  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (!messages) return;
    const prependSnapshot = prependSnapshotRef.current;
    if (prependSnapshot) {
      messages.scrollTop = prependSnapshot.scrollTop + messages.scrollHeight - prependSnapshot.scrollHeight;
      prependSnapshotRef.current = null;
      return;
    }
    if (pendingTargetRef.current === 'top') {
      messages.scrollTop = 0;
      pendingTargetRef.current = null;
      return;
    }
    if (pendingTargetRef.current === 'bottom' || followOutputRef.current) {
      messages.scrollTop = messages.scrollHeight;
      pendingTargetRef.current = null;
    }
  }, [active?.id, items.length, running, visibleStart]);

  useEffect(() => {
    const messages = messagesRef.current;
    const content = contentRef.current;
    if (!messages || !content) return;
    const observer = new ResizeObserver(() => {
      if (followOutputRef.current || pendingTargetRef.current === 'bottom') {
        messages.scrollTop = messages.scrollHeight;
        pendingTargetRef.current = null;
      }
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [active?.id]);

  const loadEarlier = () => {
    const messages = messagesRef.current;
    if (!messages || visibleStart <= 0 || prependSnapshotRef.current) return;
    followOutputRef.current = false;
    prependSnapshotRef.current = { scrollHeight: messages.scrollHeight, scrollTop: messages.scrollTop };
    setVisibleStart(current => Math.max(0, current - 120));
  };

  return (
    <div className="timeline-panel">
      <section
        className={`messages ${refreshing ? 'messages-refreshing' : ''}`}
        ref={messagesRef}
        onWheel={event => {
          if (event.deltaY >= 0) return;
          followOutputRef.current = false;
          if (event.currentTarget.scrollTop < 80) loadEarlier();
        }}
        onPointerDown={() => { pointerScrollingRef.current = true; }}
        onPointerUp={() => { pointerScrollingRef.current = false; }}
        onPointerCancel={() => { pointerScrollingRef.current = false; }}
        onScroll={event => {
          const messages = event.currentTarget;
          const distanceFromBottom = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
          if (distanceFromBottom <= 48) followOutputRef.current = true;
          else if (pointerScrollingRef.current || messages.scrollTop < previousScrollTopRef.current - 1) {
            followOutputRef.current = false;
            if (messages.scrollTop < 80) loadEarlier();
          }
          previousScrollTopRef.current = messages.scrollTop;
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
        <div className="messages-content" ref={contentRef}>
          {visibleStart > 0 && <button className="timeline-load-earlier" type="button" onClick={loadEarlier}>加载更早消息</button>}
          {renderedItems.map(item => item.type === 'message' ? (
            <MessageItem item={item} userName={userName} key={item.id} />
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
            <div className="message thinking" role="article" aria-label="Codex">
              <div className="thinking-status"><span>思考中</span><i /><i /><i /></div>
            </div>
          )}
        </div>
      </section>
      <div className="timeline-navigation" aria-label="对话滚动导航">
        <button
          type="button"
          title="滚动到最上面"
          aria-label="滚动到最上面"
          onClick={() => {
            followOutputRef.current = false;
            pendingTargetRef.current = 'top';
            if (visibleStart > 0) setVisibleStart(0);
            else {
              messagesRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
              pendingTargetRef.current = null;
            }
          }}
        ><ChevronUp size={18} /></button>
        <button
          type="button"
          title="滚动到最下面"
          aria-label="滚动到最下面"
          onClick={() => {
            followOutputRef.current = true;
            pendingTargetRef.current = 'bottom';
            const messages = messagesRef.current;
            if (!messages) return;
            messages.scrollTo({ top: messages.scrollHeight, behavior: 'smooth' });
          }}
        ><ChevronDown size={18} /></button>
      </div>
    </div>
  );
}
