import type { CSSProperties, RefObject } from 'react';
import type { Session } from '../types';

type ComposerContextUsageProps = {
  session?: Session;
  disabled: boolean;
  contextMenuOpen: boolean;
  contextUsageRef: RefObject<HTMLDivElement | null>;
  onContextMenuOpenChange(open: boolean | ((current: boolean) => boolean)): void;
  onCompact(): void;
};

export function ComposerContextUsage({ session, disabled, contextMenuOpen, contextUsageRef, onContextMenuOpenChange, onCompact }: ComposerContextUsageProps) {
  const tokenUsage = session?.tokenUsage;
  const contextTokens = tokenUsage?.last.totalTokens;
  const contextWindow = tokenUsage?.modelContextWindow;
  if (contextTokens === undefined || !contextWindow || contextWindow <= 0) return null;

  const contextPercent = Math.min(100, Math.round((contextTokens / contextWindow) * 100));
  const contextLevel = contextPercent >= 90 ? 'critical' : contextPercent >= 75 ? 'warning' : 'healthy';
  const suggestion = contextLevel === 'critical' ? '上下文即将用尽，建议压缩或清除后继续。'
    : contextLevel === 'warning' ? '上下文占用较高，建议在继续前压缩。' : undefined;
  const number = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : value.toLocaleString('zh-CN');

  return (
    <div ref={contextUsageRef} className={`context-usage ${contextLevel}`} title={`当前上下文 ${contextTokens.toLocaleString('zh-CN')} / ${contextWindow.toLocaleString('zh-CN')} tokens，累计 ${tokenUsage.total.totalTokens.toLocaleString('zh-CN')} tokens`}>
      <button type="button" className="context-usage-ring" style={{ '--context-progress': `${contextPercent}%` } as CSSProperties} onClick={() => onContextMenuOpenChange(current => !current)} aria-label="打开上下文压缩操作" aria-expanded={contextMenuOpen} title="上下文占用" />
      <span className="context-usage-value">{number(contextTokens)} / {number(contextWindow)}</span>
      <span className="context-usage-divider" aria-hidden="true" />
      <span className="context-usage-percent">{contextPercent}%</span>
      <span className="context-total">累计 {number(tokenUsage.total.totalTokens)}</span>
      {suggestion && <span className="context-suggestion">{suggestion}</span>}
      {contextMenuOpen && <div className="context-usage-menu" role="dialog" aria-label="上下文操作"><button onClick={() => { onContextMenuOpenChange(false); onCompact(); }} disabled={disabled || !session?.threadId}>压缩对话</button></div>}
    </div>
  );
}
