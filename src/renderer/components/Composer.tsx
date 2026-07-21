import { useMemo, useState } from 'react';
import { ArrowUp, ChevronDown, Eraser, FilePlus2, GitBranch, ListTodo, Minimize2, Monitor, Plus, ShieldCheck, Square } from 'lucide-react';
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
  onNewConversation(): void;
  onClearContext(): void;
  onModelChange(value: string): void;
  onReasoningEffortChange(value: string): void;
  onModeChange(value: 'default' | 'plan'): void;
};

export function Composer(props: ComposerProps) {
  const [commandIndex, setCommandIndex] = useState(0);
  const selectedModel = props.models.find(model => model.model === props.session?.model)
    || props.models.find(model => model.isDefault)
    || props.models[0];
  const disabled = !props.activeSessionId || props.running || props.compacting;
  const effortLabels: Record<string, string> = {
    minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '最高',
  };
  const status = props.compacting ? '正在压缩上下文...' : props.waiting ? '等待你的选择' : props.running ? '思考中...' : '准备就绪';
  const commands = useMemo(() => [
    { id: 'compact', name: '压缩上下文', shortcut: '/compact', description: '压缩当前对话，释放上下文空间', icon: Minimize2, disabled: disabled || !props.session?.threadId, run: props.onCompact },
    { id: 'new', name: '新对话', shortcut: '/new', description: '在当前项目中开始新对话', icon: FilePlus2, disabled: disabled || !props.session?.cwd, run: props.onNewConversation },
    { id: 'clear', name: '清除上下文', shortcut: '/clear', description: '清空当前消息并开启新的上下文', icon: Eraser, disabled, run: props.onClearContext },
  ], [disabled, props.session?.cwd, props.session?.threadId, props.onCompact, props.onNewConversation, props.onClearContext]);
  const commandQuery = props.input.startsWith('/') ? props.input.slice(1).trim().toLowerCase() : '';
  const filteredCommands = props.input.startsWith('/')
    ? commands.filter(command => `${command.name} ${command.shortcut} ${command.description}`.toLowerCase().includes(commandQuery))
    : [];
  const commandMenuOpen = filteredCommands.length > 0;
  const runCommand = (index: number) => {
    const command = filteredCommands[index];
    if (!command || command.disabled) return;
    props.onInputChange('');
    setCommandIndex(0);
    command.run();
  };
  return (
    <footer className="composer-shell">
      <div className="composer-frame">
        {commandMenuOpen && (
          <div className="command-menu" role="listbox" aria-label="命令">
            <div className="command-menu-title">命令</div>
            {filteredCommands.map((command, index) => {
              const Icon = command.icon;
              return (
                <button
                  key={command.id}
                  className={`command-item ${index === commandIndex ? 'selected' : ''}`}
                  onMouseDown={event => event.preventDefault()}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => runCommand(index)}
                  disabled={command.disabled}
                  role="option"
                  aria-selected={index === commandIndex}
                >
                  <Icon size={17} />
                  <span><b>{command.name}</b><small>{command.description}</small></span>
                  <kbd>{command.shortcut}</kbd>
                </button>
              );
            })}
          </div>
        )}
        <div className="composer-card">
        <textarea
          className="composer-input"
          value={props.input}
          onChange={event => {
            props.onInputChange(event.target.value);
            setCommandIndex(0);
          }}
          onKeyDown={event => {
            if (commandMenuOpen) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                setCommandIndex(current => (current + direction + filteredCommands.length) % filteredCommands.length);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                props.onInputChange('');
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                runCommand(commandIndex);
                return;
              }
            }
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
            {props.running ? (
              <button className="send-button stop" onClick={() => props.activeSessionId && window.codex.stop(props.activeSessionId)} title="停止" aria-label="停止"><Square size={15} /></button>
            ) : (
              <button className="send-button" onClick={props.onSend} disabled={!props.activeSessionId || props.compacting || !props.input.trim()} title="发送" aria-label="发送"><ArrowUp size={19} /></button>
            )}
          </div>
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
