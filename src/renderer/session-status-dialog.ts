import { resolveModel, resolveReasoningEffort } from './model-utils';
import type { CodexModel, PermissionMode, Session } from './types';
import type { AppDialogState } from './components/AppDialog';

type CreateSessionStatusDialogOptions = {
  session: Session;
  models: CodexModel[];
  preferredModel?: string;
  permissionMode: PermissionMode;
  running: boolean;
  onClose(): void;
};

export function createSessionStatusDialog({ session, models, preferredModel, permissionMode, running, onClose }: CreateSessionStatusDialogOptions): AppDialogState {
  const effortLabels: Record<string, string> = { minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '最高' };
  const statusLabels: Record<string, string> = { notLoaded: '未加载', idle: '空闲', systemError: '系统错误', active: '运行中' };
  const flags = session.threadStatus?.activeFlags || [];
  const status = flags.includes('waitingOnApproval') ? '等待批准'
    : flags.includes('waitingOnUserInput') ? '等待用户输入'
      : statusLabels[session.threadStatus?.type || ''] || (running ? '运行中' : '空闲');
  const selectedModel = resolveModel(models, session.model, preferredModel);
  const effort = resolveReasoningEffort(session.reasoningEffort, selectedModel);
  const tokenUsage = session.tokenUsage;
  const number = (value: number) => new Intl.NumberFormat('zh-CN').format(value);
  const hasTokenUsage = !!tokenUsage && Number.isFinite(tokenUsage.last.totalTokens) && Number.isFinite(tokenUsage.total.totalTokens);
  const context = tokenUsage && hasTokenUsage
    ? `${number(tokenUsage.last.totalTokens)}${Number.isFinite(tokenUsage.modelContextWindow) && tokenUsage.modelContextWindow ? ` / ${number(tokenUsage.modelContextWindow)}` : ''}${session.tokenUsagePending ? '（等待更新）' : ''}`
    : '等待 Codex 首次报告';
  return {
    title: '会话状态',
    details: [
      { label: '状态', value: status },
      { label: '线程 ID', value: session.threadId || '尚未创建' },
      { label: '项目', value: session.cwd || '未选择' },
      { label: '模型', value: selectedModel?.displayName || session.model || '默认' },
      { label: '推理强度', value: effortLabels[effort || ''] || effort || '默认' },
      { label: '协作模式', value: session.collaborationMode === 'plan' ? '计划模式' : '默认模式' },
      { label: '权限', value: permissionMode === 'yolo' ? 'YOLO 权限' : '默认权限' },
      { label: '最近报告的上下文用量', value: context },
      { label: '累计 token', value: tokenUsage && hasTokenUsage ? number(tokenUsage.total.totalTokens) : '等待 Codex 首次报告' },
    ],
    onConfirm: onClose,
  };
}
