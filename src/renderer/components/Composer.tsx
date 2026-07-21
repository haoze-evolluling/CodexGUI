import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Bot, BrainCircuit, Check, ChevronDown, Eraser, FilePlus2, GitBranch, ListTodo, Minimize2, Monitor, Plus, ShieldCheck, Square } from 'lucide-react';
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
  onChooseFile(): void;
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
  const [openSelector, setOpenSelector] = useState<'model' | 'effort' | null>(null);
  const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);
  const selectorsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const clearButtonRef = useRef<HTMLButtonElement>(null);
  const selectedModel = props.models.find(model => model.model === props.session?.model)
    || props.models.find(model => model.isDefault)
    || props.models[0];
  const disabled = !props.activeSessionId || props.running || props.compacting;
  const effortLabels: Record<string, string> = {
    minimal: '最低', low: '低', medium: '中', high: '高', xhigh: '最高',
  };
  const effortDescriptions: Record<string, string> = {
    minimal: '快速响应，适合简单任务',
    low: '轻量推理，适合日常问题',
    medium: '平衡速度与推理深度',
    high: '深入推理，适合复杂任务',
    xhigh: '最大推理深度，耗时更长',
  };
  const activeEffort = props.session?.reasoningEffort || selectedModel?.defaultReasoningEffort || '';
  const status = props.compacting ? '正在压缩上下文...' : props.waiting ? '等待你的选择' : props.running ? '思考中...' : '准备就绪';
  const commands = useMemo(() => [
    { id: 'compact', name: '压缩上下文', shortcut: '/compact', description: '压缩当前对话，释放上下文空间', icon: Minimize2, disabled: disabled || !props.session?.threadId, run: props.onCompact },
    { id: 'new', name: '新对话', shortcut: '/new', description: '在当前项目中开始新对话', icon: FilePlus2, disabled: disabled || !props.session?.cwd, run: props.onNewConversation },
    { id: 'clear', name: '清除上下文', shortcut: '/clear', description: '清空当前消息并开启新的上下文', icon: Eraser, disabled, run: () => setClearConfirmationOpen(true) },
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
  useEffect(() => {
    const closeSelector = (event: MouseEvent) => {
      if (!selectorsRef.current?.contains(event.target as Node)) setOpenSelector(null);
    };
    window.addEventListener('mousedown', closeSelector);
    return () => window.removeEventListener('mousedown', closeSelector);
  }, []);
  useEffect(() => {
    if (clearConfirmationOpen) clearButtonRef.current?.focus();
  }, [clearConfirmationOpen]);
  const closeClearConfirmation = () => {
    setClearConfirmationOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };
  const confirmClearContext = () => {
    setClearConfirmationOpen(false);
    props.onClearContext();
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };
  return (
    <footer className="composer-shell">
      {clearConfirmationOpen && (
        <div
          className="clear-confirm-backdrop"
          onMouseDown={event => { if (event.target === event.currentTarget) closeClearConfirmation(); }}
        >
          <div
            className="clear-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="clear-confirm-title"
            aria-describedby="clear-confirm-description"
            onKeyDown={event => { if (event.key === 'Escape') closeClearConfirmation(); }}
          >
            <div className="clear-confirm-icon"><Eraser size={19} /></div>
            <div className="clear-confirm-copy">
              <b id="clear-confirm-title">清除当前上下文？</b>
              <p id="clear-confirm-description">当前消息和对话上下文将被清空，项目文件不会受到影响。</p>
            </div>
            <div className="clear-confirm-actions">
              <button onClick={closeClearConfirmation}>取消</button>
              <button ref={clearButtonRef} className="danger" onClick={confirmClearContext}>清除上下文</button>
            </div>
          </div>
        </div>
      )}
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
        <div className={`composer-card ${openSelector ? 'selector-active' : ''}`}>
        <textarea
          ref={inputRef}
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
        />
        <div className="composer-toolbar">
          <div className="composer-tools" ref={selectorsRef}>
            <button
              className="composer-icon"
              onClick={props.onChooseFile}
              disabled={disabled}
              title="添加文件"
              aria-label="添加文件"
            ><Plus size={18} /></button>
            <div className={`selector-control model-control ${openSelector === 'model' ? 'open' : ''}`}>
              <button
                className="selector-trigger"
                onClick={() => setOpenSelector(current => current === 'model' ? null : 'model')}
                disabled={disabled || !props.models.length}
                aria-label="选择模型"
                aria-expanded={openSelector === 'model'}
              >
                <Bot size={16} />
                <span>{selectedModel?.displayName || '选择模型'}</span>
                <ChevronDown size={14} />
              </button>
              {openSelector === 'model' && (
                <div className="selector-menu model-menu" role="listbox" aria-label="模型列表">
                  <div className="selector-menu-heading">选择模型</div>
                  {props.models.map(model => {
                    const active = model.model === selectedModel?.model;
                    return (
                      <button
                        key={model.id}
                        className={`selector-option model-option ${active ? 'selected' : ''}`}
                        onClick={() => { props.onModelChange(model.model); setOpenSelector(null); }}
                        role="option"
                        aria-selected={active}
                      >
                        <Bot size={16} />
                        <span><b>{model.displayName}</b><small>{model.description || model.model}</small></span>
                        {active && <Check size={16} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className={`selector-control effort-control ${openSelector === 'effort' ? 'open' : ''}`}>
              <button
                className="selector-trigger"
                onClick={() => setOpenSelector(current => current === 'effort' ? null : 'effort')}
                disabled={disabled || !selectedModel}
                aria-label="选择推理强度"
                aria-expanded={openSelector === 'effort'}
              >
                <BrainCircuit size={16} />
                <span>{effortLabels[activeEffort] || activeEffort || '推理'}</span>
                <ChevronDown size={14} />
              </button>
              {openSelector === 'effort' && (
                <div className="selector-menu effort-menu" role="listbox" aria-label="推理强度列表">
                  <div className="selector-menu-heading">推理强度</div>
                  {(selectedModel?.supportedReasoningEfforts || []).map(option => {
                    const active = option.reasoningEffort === activeEffort;
                    return (
                      <button
                        key={option.reasoningEffort}
                        className={`selector-option effort-option ${active ? 'selected' : ''}`}
                        onClick={() => { props.onReasoningEffortChange(option.reasoningEffort); setOpenSelector(null); }}
                        role="option"
                        aria-selected={active}
                      >
                        <span><b>{effortLabels[option.reasoningEffort] || option.reasoningEffort}</b><small>{option.description || effortDescriptions[option.reasoningEffort]}</small></span>
                        {active && <Check size={16} />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
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
