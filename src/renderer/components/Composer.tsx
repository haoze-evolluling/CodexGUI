import { ArrowUp, ChevronDown, GitBranch, ListTodo, Minimize2, Monitor, Plus, ShieldCheck, Square } from 'lucide-react';
import type { CodexModel, CollaborationMode, Session } from '../types';

type ComposerProps = {
  activeSessionId?: string;
  input: string;
  running: boolean;
  compacting: boolean;
  waiting: boolean;
  session?: Session;
  models: CodexModel[];
  collaborationModes: CollaborationMode[];
  onInputChange(value: string): void;
  onSend(): void;
  onCompact(): void;
  onModelChange(value: string): void;
  onReasoningEffortChange(value: string): void;
  onModeChange(value: 'default' | 'plan'): void;
};

export function Composer(props: ComposerProps) {
  const selectedModel = props.models.find(model => model.model === props.session?.model)
    || props.models.find(model => model.isDefault)
    || props.models[0];
  const disabled = !props.activeSessionId || props.running || props.compacting;
  const effortLabels: Record<string, string> = {
    minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '最高',
  };
  const status = props.compacting ? '正在压缩上下文...' : props.waiting ? '等待你的选择' : props.running ? '思考中...' : '准备就绪';
  return (
    <footer className="composer-shell">
      <div className="composer-card">
        <textarea
          className="composer-input"
          value={props.input}
          onChange={event => props.onInputChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              props.onSend();
            }
          }}
          placeholder="向 Codex 提问，@ 添加文件，/ 调出命令"
          disabled={!props.activeSessionId || props.compacting}
        />
        <div className="composer-toolbar">
          <div className="composer-tools">
            <button className="composer-icon" disabled title="添加附件（暂不可用）" aria-label="添加附件"><Plus size={18} /></button>
            <label className="select-control" title="模型">
              <select value={props.session?.model || selectedModel?.model || ''} onChange={event => props.onModelChange(event.target.value)} disabled={disabled || !props.models.length} aria-label="模型">
                {props.models.map(model => <option key={model.id} value={model.model}>{model.displayName}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
            <label className="select-control effort-control" title="推理强度">
              <select value={props.session?.reasoningEffort || selectedModel?.defaultReasoningEffort || ''} onChange={event => props.onReasoningEffortChange(event.target.value)} disabled={disabled || !selectedModel} aria-label="推理强度">
                {(selectedModel?.supportedReasoningEfforts || []).map(option => <option key={option.reasoningEffort} value={option.reasoningEffort}>{effortLabels[option.reasoningEffort] || option.reasoningEffort}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
            <button
              className={`mode-toggle ${props.session?.collaborationMode === 'plan' ? 'selected' : ''}`}
              onClick={() => props.onModeChange(props.session?.collaborationMode === 'plan' ? 'default' : 'plan')}
              disabled={disabled || !props.collaborationModes.some(mode => mode.mode === 'plan')}
              title="切换计划模式"
            >
              <ListTodo size={16} /> 计划
            </button>
          </div>
          <div className="composer-actions">
            <button className="composer-icon" onClick={props.onCompact} disabled={disabled || !props.session?.threadId} title="压缩当前对话上下文" aria-label="压缩当前对话上下文"><Minimize2 size={17} /></button>
            {props.running ? (
              <button className="send-button stop" onClick={() => props.activeSessionId && window.codex.stop(props.activeSessionId)} title="停止" aria-label="停止"><Square size={15} /></button>
            ) : (
              <button className="send-button" onClick={props.onSend} disabled={!props.activeSessionId || props.compacting || !props.input.trim()} title="发送" aria-label="发送"><ArrowUp size={19} /></button>
            )}
          </div>
        </div>
      </div>
      <div className="composer-meta">
        <div className="composer-context">
          <span title={props.session?.cwd || '未选择项目文件夹'}><Monitor size={14} /> 本地</span>
          <span><ShieldCheck size={14} /> 默认权限</span>
        </div>
        <div className="composer-status">
          <span>{status}</span>
          <span className="branch-status"><GitBranch size={14} /> 当前工作区</span>
        </div>
      </div>
    </footer>
  );
}
