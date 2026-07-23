import { type CSSProperties, useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, BrainCircuit, Check, ChevronDown, GitBranch, ListTodo, Monitor, Plus, ShieldAlert, ShieldCheck, Square } from 'lucide-react';
import { AttachmentTokens } from './AttachmentTokens';
import type { ComposerProps } from './composer-types';
import { useComposerCommands } from './use-composer-commands';
import { resolveModel, resolveReasoningEffort } from '../model-utils';

export function Composer(props: ComposerProps) {
  const [openSelector, setOpenSelector] = useState<'model' | 'effort' | 'permission' | null>(null);
  const selectorsRef = useRef<HTMLDivElement>(null);
  const permissionSelectorRef = useRef<HTMLDivElement>(null);
  const contextUsageRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLDivElement>(null);
  const commandMenuRef = useRef<HTMLDivElement>(null);
  const selectedCommandRef = useRef<HTMLButtonElement>(null);
  const [customModelDraft, setCustomModelDraft] = useState('');
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const requestedModel = props.session?.model || props.preferredModel || '';
  const selectedModel = resolveModel(props.models, props.session?.model, props.preferredModel);
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
  const activeEffort = resolveReasoningEffort(props.session?.reasoningEffort, selectedModel) || '';
  const status = props.compacting ? '正在压缩上下文...' : props.waiting ? '等待你的选择' : props.running ? '思考中...' : '准备就绪';
  const tokenUsage = props.session?.tokenUsage;
  const contextTokens = tokenUsage?.last.totalTokens;
  const contextWindow = tokenUsage?.modelContextWindow;
  const contextPercent = contextTokens !== undefined && contextWindow && contextWindow > 0
    ? Math.min(100, Math.round((contextTokens / contextWindow) * 100))
    : undefined;
  const contextLevel = contextPercent === undefined ? 'unknown' : contextPercent >= 90 ? 'critical' : contextPercent >= 75 ? 'warning' : 'healthy';
  const contextSuggestion = contextLevel === 'critical'
    ? '上下文即将用尽，建议压缩或清除后继续。'
    : contextLevel === 'warning'
      ? '上下文占用较高，建议在继续前压缩。'
      : undefined;
  const number = (value: number) => value >= 1000
    ? `${(value / 1000).toFixed(value >= 10000 ? 0 : 1).replace(/\.0$/, '')}k`
    : value.toLocaleString('zh-CN');
  const { commandIndex, commandMenuOpen, filteredCommands, runCommand: executeCommand, setCommandIndex, setSkillPaletteOpen, skillPaletteOpen } = useComposerCommands({
    ...props,
    disabled,
    selectedModel,
    setOpenSelector,
  });
  const runCommand = (index: number) => {
    if (executeCommand(index)) window.requestAnimationFrame(() => focusEditorAt('end'));
  };
  const skillPrefix = props.selectedSkill ? `/${props.selectedSkill.name}` : '';
  const inputBody = skillPrefix && (props.input === skillPrefix || props.input.startsWith(`${skillPrefix} `))
    ? props.input.slice(skillPrefix.length).replace(/^ /, '')
    : props.input;
  const resizeComposerInput = (editor?: HTMLDivElement | null) => {
    if (!editor) return;
    const maxHeight = 220;
    const minHeight = 72;
    editor.style.height = 'auto';
    const contentHeight = editor.scrollHeight;
    const nextHeight = Math.min(Math.max(contentHeight, minHeight), maxHeight);
    editor.style.height = `${nextHeight}px`;
    editor.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
  };

  const keepCaretVisible = (editor?: HTMLDivElement | null) => {
    if (!editor) return;
    resizeComposerInput(editor);
    editor.scrollTop = editor.scrollHeight;
  };

  const focusEditorAt = (position: 'start' | 'end') => {
    const editor = inputRef.current;
    if (!editor) return;
    editor.focus();
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(position === 'start');
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    keepCaretVisible(editor);
  };

  const readEditorBody = (editor: HTMLDivElement) => {
    const copy = editor.cloneNode(true) as HTMLDivElement;
    copy.querySelector('[data-skill-token]')?.remove();
    return copy.innerText.replace(/\r/g, '');
  };

  const updateFromEditor = (editor: HTMLDivElement) => {
    const body = props.selectedSkill ? readEditorBody(editor) : editor.innerText.replace(/\r/g, '');
    props.onInputChange(skillPrefix ? `${skillPrefix}${body ? ` ${body}` : ''}` : body);
  };

  const syncEditorContent = (editor: HTMLDivElement) => {
    const currentBody = props.selectedSkill ? readEditorBody(editor) : editor.innerText.replace(/\r/g, '');
    const currentValue = skillPrefix ? `${skillPrefix}${currentBody ? ` ${currentBody}` : ''}` : currentBody;
    if (currentValue === props.input && (!!props.selectedSkill === !!editor.querySelector('[data-skill-token]'))) return;

    editor.replaceChildren();
    if (props.selectedSkill) {
      const token = document.createElement('span');
      token.className = 'skill-token';
      token.dataset.skillToken = 'true';
      token.contentEditable = 'false';
      token.textContent = skillPrefix;
      editor.append(token);
    }
    if (inputBody) editor.append(document.createTextNode(inputBody));
  };

  const isCaretAfterSkillToken = (editor: HTMLDivElement) => {
    if (!skillPrefix) return false;
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.endContainer)) return false;
    const beforeCaret = range.cloneRange();
    beforeCaret.selectNodeContents(editor);
    beforeCaret.setEnd(range.endContainer, range.endOffset);
    return beforeCaret.toString() === skillPrefix;
  };

  const insertTextAtSelection = (editor: HTMLDivElement, text: string) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const textNode = document.createTextNode(text);
    range.insertNode(textNode);
    range.setStartAfter(textNode);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    updateFromEditor(editor);
    window.requestAnimationFrame(() => keepCaretVisible(editor));
  };

  useEffect(() => {
    const closeSelector = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!selectorsRef.current?.contains(target) && !permissionSelectorRef.current?.contains(target)) setOpenSelector(null);
      if (!contextUsageRef.current?.contains(target)) setContextMenuOpen(false);
    };
    window.addEventListener('mousedown', closeSelector);
    return () => window.removeEventListener('mousedown', closeSelector);
  }, []);
  useEffect(() => {
    const menu = commandMenuRef.current;
    const selectedCommand = selectedCommandRef.current;
    if (!menu || !selectedCommand) return;

    const menuBounds = menu.getBoundingClientRect();
    const commandBounds = selectedCommand.getBoundingClientRect();
    if (commandBounds.top < menuBounds.top) {
      menu.scrollTop += commandBounds.top - menuBounds.top;
    } else if (commandBounds.bottom > menuBounds.bottom) {
      menu.scrollTop += commandBounds.bottom - menuBounds.bottom;
    }
  }, [commandIndex, commandMenuOpen]);
  useEffect(() => {
    const editor = inputRef.current;
    if (!editor) return;
    syncEditorContent(editor);
    keepCaretVisible(inputRef.current);
  }, [props.input, props.selectedSkill]);
  return (
    <footer className="composer-shell">
      <div className="composer-frame">
        {commandMenuOpen && (
          <div className="command-menu" ref={commandMenuRef} role="listbox" aria-label="命令和 Skills">
            {filteredCommands.map((command, index) => {
              const Icon = command.icon;
              return (
                <div className="command-menu-entry" key={command.id}>
                  {(index === 0 || filteredCommands[index - 1].kind !== command.kind) && (
                    <div className="command-menu-title">{command.kind === 'skill' ? 'Skills' : '命令'}</div>
                  )}
                  <button
                    ref={index === commandIndex ? selectedCommandRef : null}
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
                </div>
              );
            })}
          </div>
        )}
        <div
          className={`composer-card ${openSelector ? 'selector-active' : ''}`}
          onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
          onDrop={event => {
            event.preventDefault();
            if (disabled) return;
            const paths = Array.from(event.dataTransfer.files)
              .map(file => window.codex.getPathForFile(file))
              .filter(Boolean);
            props.onAddFiles(paths);
          }}
        >
        {!!props.attachments.length && (
          <AttachmentTokens attachments={props.attachments} onRemove={props.onRemoveAttachment} />
        )}
        <div
          ref={inputRef}
          className={`composer-input ${!inputBody ? 'is-empty' : ''}`}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="消息输入"
          data-placeholder="向 Codex 提问，@ 添加文件，/ 调出命令"
          onInput={event => {
            setSkillPaletteOpen(false);
            updateFromEditor(event.currentTarget);
            setCommandIndex(0);
            window.requestAnimationFrame(() => keepCaretVisible(event.target));
          }}
          onContextMenu={event => {
            event.preventDefault();
            const editor = event.currentTarget;
            props.onInputContextMenu(event, text => {
              editor.focus();
              insertTextAtSelection(editor, text);
            });
          }}
          onKeyDown={event => {
            const editor = event.currentTarget;
            if (event.key === 'Backspace' && isCaretAfterSkillToken(editor)) {
              event.preventDefault();
              props.onInputChange(inputBody);
              window.requestAnimationFrame(() => focusEditorAt('start'));
              return;
            }
            if (event.key === 'Backspace' && !props.input && props.attachments.length) {
              event.preventDefault();
              props.onRemoveAttachment(props.attachments[props.attachments.length - 1].id);
              return;
            }
            if (event.key === 'Enter' && event.ctrlKey) {
              event.preventDefault();
              insertTextAtSelection(editor, '\n');
              return;
            }
            if (commandMenuOpen) {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                setCommandIndex(current => (current + direction + filteredCommands.length) % filteredCommands.length);
                return;
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                if (skillPaletteOpen) setSkillPaletteOpen(false);
                else props.onInputChange('');
                return;
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
                event.preventDefault();
                runCommand(commandIndex);
                return;
              }
            }
            if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey) {
              event.preventDefault();
              props.onSend();
            }
          }}
        />
        <div className="composer-toolbar">
          <div className="composer-tools" ref={selectorsRef}>
            <button
              className="composer-icon"
              onClick={props.onChooseFiles}
              disabled={disabled}
              title="添加文件"
              aria-label="添加文件"
            ><Plus size={18} /></button>
            <div className={`selector-control model-control ${openSelector === 'model' ? 'open' : ''}`}>
              <button
                className="selector-trigger"
                onClick={() => setOpenSelector(current => {
                  if (current === 'model') return null;
                  setCustomModelDraft(selectedModel?.model || requestedModel || '');
                  return 'model';
                })}
                disabled={disabled}
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
                  <form
                    className="custom-model-form"
                    onSubmit={event => {
                      event.preventDefault();
                      const name = customModelDraft.trim();
                      if (!name) return;
                      props.onModelChange(name);
                      setOpenSelector(null);
                    }}
                  >
                    <input
                      className="custom-model-input"
                      value={customModelDraft}
                      onChange={event => setCustomModelDraft(event.target.value)}
                      placeholder="输入自定义模型名称"
                      spellCheck={false}
                      aria-label="自定义模型名称"
                    />
                    <button type="submit" className="custom-model-apply" disabled={!customModelDraft.trim()}>
                      使用
                    </button>
                  </form>
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
                  {requestedModel && !props.models.some(model => model.model === requestedModel) && (
                    <button
                      className={`selector-option model-option ${selectedModel?.model === requestedModel ? 'selected' : ''}`}
                      onClick={() => { props.onModelChange(requestedModel); setOpenSelector(null); }}
                      role="option"
                      aria-selected={selectedModel?.model === requestedModel}
                    >
                      <Bot size={16} />
                      <span><b>{requestedModel}</b><small>自定义模型</small></span>
                      {selectedModel?.model === requestedModel && <Check size={16} />}
                    </button>
                  )}
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
              <button className="send-button" onClick={() => props.onSend()} disabled={!props.activeSessionId || props.compacting || (!props.input.trim() && !props.attachments.length)} title="发送" aria-label="发送"><ArrowUp size={19} /></button>
            )}
          </div>
        </div>
        </div>
      </div>
      <div className="composer-meta">
        <div className="composer-context">
          <span title={props.session?.cwd || '未选择项目文件夹'}><Monitor size={14} /> 本地</span>
          <div ref={permissionSelectorRef} className={`selector-control permission-control ${openSelector === 'permission' ? 'open' : ''}`}>
            <button
              className="permission-trigger"
              onClick={() => setOpenSelector(current => current === 'permission' ? null : 'permission')}
              disabled={disabled}
              aria-label="选择权限模式"
              aria-expanded={openSelector === 'permission'}
            >
              {props.permissionMode === 'yolo' ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
              <span>{props.permissionMode === 'yolo' ? 'YOLO 权限' : '默认权限'}</span>
              <ChevronDown size={13} />
            </button>
            {openSelector === 'permission' && (
              <div className="selector-menu permission-menu" role="listbox" aria-label="权限模式列表">
                <div className="selector-menu-heading">权限模式</div>
                <button
                  className={`selector-option permission-option ${props.permissionMode === 'default' ? 'selected' : ''}`}
                  onClick={() => { props.onPermissionModeChange('default'); setOpenSelector(null); }}
                  role="option"
                  aria-selected={props.permissionMode === 'default'}
                >
                  <ShieldCheck size={16} />
                  <span><b>默认模式</b><small>遵循 Codex 配置，敏感操作可能需要批准</small></span>
                  {props.permissionMode === 'default' && <Check size={16} />}
                </button>
                <button
                  className={`selector-option permission-option danger ${props.permissionMode === 'yolo' ? 'selected' : ''}`}
                  onClick={() => { props.onPermissionModeChange('yolo'); setOpenSelector(null); }}
                  role="option"
                  aria-selected={props.permissionMode === 'yolo'}
                >
                  <ShieldAlert size={16} />
                  <span><b>YOLO 模式</b><small>不请求批准，并允许完整文件系统访问</small></span>
                  {props.permissionMode === 'yolo' && <Check size={16} />}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="composer-status">
          <span>{status}</span>
          {contextTokens !== undefined && contextWindow && contextWindow > 0 && (
            <div ref={contextUsageRef} className={`context-usage ${contextLevel}`} title={`当前上下文 ${contextTokens.toLocaleString('zh-CN')} / ${contextWindow.toLocaleString('zh-CN')} tokens，累计 ${tokenUsage?.total.totalTokens.toLocaleString('zh-CN')} tokens`}>
              <button
                type="button"
                className="context-usage-ring"
                style={{ '--context-progress': `${contextPercent}%` } as CSSProperties}
                onClick={() => setContextMenuOpen(current => !current)}
                aria-label="打开上下文压缩操作"
                aria-expanded={contextMenuOpen}
                title="上下文占用"
              />
              <span className="context-usage-value">{number(contextTokens)} / {number(contextWindow)}</span>
              <span className="context-usage-divider" aria-hidden="true" />
              <span className="context-usage-percent">{contextPercent}%</span>
              <span className="context-total">累计 {number(tokenUsage.total.totalTokens)}</span>
              {contextSuggestion && <span className="context-suggestion">{contextSuggestion}</span>}
              {contextMenuOpen && (
                <div className="context-usage-menu" role="dialog" aria-label="上下文操作">
                  <button
                    onClick={() => {
                      setContextMenuOpen(false);
                      props.onCompact();
                    }}
                    disabled={disabled || !props.session?.threadId}
                  >
                    压缩对话
                  </button>
                </div>
              )}
            </div>
          )}
          <span className="branch-status"><GitBranch size={14} /> 当前工作区</span>
        </div>
      </div>
    </footer>
  );
}
