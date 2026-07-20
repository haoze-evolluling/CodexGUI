import { Brain, Minimize2, Send, Square } from 'lucide-react';
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
  return (
    <footer>
      <div className="composer-tools">
        <select value={props.session?.model || selectedModel?.model || ''} onChange={event => props.onModelChange(event.target.value)} disabled={disabled || !props.models.length} title="模型">
          {props.models.map(model => <option key={model.id} value={model.model}>{model.displayName}</option>)}
        </select>
        <select value={props.session?.reasoningEffort || selectedModel?.defaultReasoningEffort || ''} onChange={event => props.onReasoningEffortChange(event.target.value)} disabled={disabled || !selectedModel} title="推理强度">
          {(selectedModel?.supportedReasoningEfforts || []).map(option => <option key={option.reasoningEffort} value={option.reasoningEffort}>{option.reasoningEffort}</option>)}
        </select>
        <div className="mode-control" aria-label="工作模式">
          <button className={props.session?.collaborationMode !== 'plan' ? 'selected' : ''} onClick={() => props.onModeChange('default')} disabled={disabled}>Work</button>
          <button className={props.session?.collaborationMode === 'plan' ? 'selected' : ''} onClick={() => props.onModeChange('plan')} disabled={disabled || !props.collaborationModes.some(mode => mode.mode === 'plan')}><Brain size={14} /> Plan</button>
        </div>
        <button className="icon compact" onClick={props.onCompact} disabled={disabled || !props.session?.threadId} title="压缩当前对话上下文"><Minimize2 size={17} /></button>
      </div>
      <textarea
        value={props.input}
        onChange={event => props.onInputChange(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            props.onSend();
          }
        }}
        placeholder="让 Codex 处理这个项目..."
        disabled={!props.activeSessionId || props.compacting}
      />
      <div className="actions">
        <span>{props.compacting ? '正在压缩上下文...' : props.waiting ? '等待你的选择' : props.running ? '思考中...' : '准备就绪'}</span>
        {props.running ? (
          <button className="stop" onClick={() => props.activeSessionId && window.codex.stop(props.activeSessionId)}>
            <Square size={16} /> 停止
          </button>
        ) : (
          <button onClick={props.onSend} disabled={!props.activeSessionId || props.compacting}>
            <Send size={16} /> 发送
          </button>
        )}
      </div>
    </footer>
  );
}
