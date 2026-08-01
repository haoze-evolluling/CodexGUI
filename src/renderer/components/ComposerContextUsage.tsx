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
  const hasUsage = typeof contextTokens === 'number' && Number.isFinite(contextTokens)
    && !!tokenUsage && Number.isFinite(tokenUsage.total.totalTokens);
  const hasContextWindow = hasUsage && typeof contextWindow === 'number' && Number.isFinite(contextWindow) && contextWindow > 0;
  const contextTokensValue = hasUsage ? contextTokens : 0;
  const contextWindowValue = hasContextWindow ? contextWindow : 0;
  const contextPercent = hasContextWindow ? Math.min(100, Math.round((contextTokensValue / contextWindowValue) * 100)) : 0;
  const contextLevel = contextPercent >= 90 ? 'critical' : contextPercent >= 75 ? 'warning' : 'healthy';
  const suggestion = session?.tokenUsagePending || !hasContextWindow ? undefined
    : contextLevel === 'critical' ? '上下文即将用尽，建议压缩或清除后继续。'
      : contextLevel === 'warning' ? '上下文占用较高，建议在继续前压缩。' : undefined;
  const number = (value: number) => value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, '')}k` : value.toLocaleString('zh-CN');
  const title = !hasUsage ? 'Codex 尚未报告上下文用量'
    : `Codex 最近报告的上下文用量 ${contextTokensValue.toLocaleString('zh-CN')}${hasContextWindow ? ` / ${contextWindowValue.toLocaleString('zh-CN')}` : ''} tokens，累计 ${tokenUsage.total.totalTokens.toLocaleString('zh-CN')} tokens${session?.tokenUsagePending ? '，等待更新' : ''}`;

  return (
    <div ref={contextUsageRef} className={`context-usage ${contextLevel}${session?.tokenUsagePending || !hasUsage ? ' pending' : ''}`} title={title}>
      <button type="button" className="context-usage-ring" style={{ '--context-progress': `${contextPercent}%` } as CSSProperties} onClick={() => onContextMenuOpenChange(current => !current)} aria-label="打开上下文压缩操作" aria-expanded={contextMenuOpen} title="上下文占用" />
      {hasUsage ? <>
        <span className="context-usage-value">{number(contextTokensValue)}{hasContextWindow ? ` / ${number(contextWindowValue)}` : ''}</span>
        {hasContextWindow && <><span className="context-usage-divider" aria-hidden="true" /><span className="context-usage-percent">{contextPercent}%</span></>}
        <span className="context-total">累计 {number(tokenUsage.total.totalTokens)}</span>
        {session?.tokenUsagePending && <span className="context-refreshing">等待更新</span>}
      </> : <span className="context-usage-empty">等待 Codex 首次报告</span>}
      {suggestion && <span className="context-suggestion">{suggestion}</span>}
      {contextMenuOpen && <div className="context-usage-menu" role="dialog" aria-label="上下文操作"><button onClick={() => { onContextMenuOpenChange(false); onCompact(); }} disabled={disabled || !session?.threadId}>压缩对话</button></div>}
    </div>
  );
}
