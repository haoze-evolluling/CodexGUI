import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Bot, BrainCircuit, Check, ChevronDown, GitBranch, ListTodo, Monitor, Plus, ShieldAlert, ShieldCheck, Square } from 'lucide-react';
import { AttachmentTokens } from './AttachmentTokens';
import type { ComposerProps } from './composer-types';
import { useComposerCommands } from './use-composer-commands';
import { resolveModel, resolveReasoningEffort } from '../model-utils';
import { ComposerCommandPalette } from './ComposerCommandPalette';
import { ComposerContextUsage } from './ComposerContextUsage';

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
  const [stopButtonVisible, setStopButtonVisible] = useState(props.running);
  const [stopButtonExiting, setStopButtonExiting] = useState(false);
  const requestedModel = props.session?.model || props.preferredModel || '';
  const selectedModel = resolveModel(props.models, props.session?.model, props.preferredModel);
  const inputDisabled = !props.activeSessionId || props.compacting;
  const disabled = inputDisabled || props.running || props.rollingBack;
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
  const applyMention = (relativePath: string) => {
    const cwd = props.session?.cwd;
    if (!cwd) return;
    const separator = cwd.includes('\\') ? '\\' : '/';
    const base = cwd.replace(/[\\/]+$/, '');
    const absolutePath = `${base}${separator}${relativePath.split('/').join(separator)}`;
    props.onAddFiles([absolutePath]);
    props.onInputChange(props.input.replace(/(^|\s)@[^\s@]*$/, (_match, prefix) => prefix || ''));
  };
  const { commandIndex, commandMenuOpen, filteredCommands, runCommand: executeCommand, setCommandIndex, setSkillPaletteOpen, skillPaletteOpen } = useComposerCommands({
    ...props,
    disabled,
    selectedModel,
    setOpenSelector,
    listMentionFiles: props.listMentionFiles,
    onMentionSelect: applyMention,
  });
  const runCommand = (index: number) => {
    if (executeCommand(index)) window.requestAnimationFrame(() => focusEditorAt('end'));
  };
  const skillPrefix = props.selectedSkill ? `/${props.selectedSkill.name}` : '';
  const inputBodyFor = (value: string) => skillPrefix && (value === skillPrefix || value.startsWith(`${skillPrefix} `))
    ? value.slice(skillPrefix.length).replace(/^ /, '')
    : value;
  const inputBody = inputBodyFor(props.input);
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
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.endContainer)) return;

    const caretRect = range.getClientRects().item(range.getClientRects().length - 1) || range.getBoundingClientRect();
    const editorRect = editor.getBoundingClientRect();
    if (caretRect.top < editorRect.top) {
      editor.scrollTop += caretRect.top - editorRect.top;
    } else if (caretRect.bottom > editorRect.bottom) {
      editor.scrollTop += caretRect.bottom - editorRect.bottom;
    }
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

  const isBlockElement = (node: Node) => node.nodeType === Node.ELEMENT_NODE
    && ['DIV', 'P', 'LI'].includes((node as Element).tagName);

  const readEditorText = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    // Chromium may place text typed after Ctrl+Enter inside this caret holder.
    // Only remove its zero-width placeholder; keep the user's actual text.
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute('data-line-break-caret')) {
      return (node.textContent || '').replace(/\u200B/g, '');
    }
    if (node.nodeType === Node.ELEMENT_NODE && (node as Element).tagName === 'BR') return '\n';
    return Array.from(node.childNodes).reduce((text, child, index, children) => {
      const before = isBlockElement(child) && text && !text.endsWith('\n') ? '\n' : '';
      const after = isBlockElement(child) && index < children.length - 1 ? '\n' : '';
      return `${text}${before}${readEditorText(child)}${after}`;
    }, '');
  };

  const normalizeEditorText = (text: string) => text.replace(/[\r\u200B]/g, '');

  const hasMeaningfulEditorContent = (node: Node): boolean => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent || '').replace(/\u200B/g, '').length > 0;
    if (node.nodeType !== Node.ELEMENT_NODE) return false;
    const element = node as Element;
    if (element.tagName === 'BR') return false;
    return Array.from(node.childNodes).some(hasMeaningfulEditorContent);
  };

  const readEditorBody = (editor: HTMLDivElement) => {
    const copy = editor.cloneNode(true) as HTMLDivElement;
    copy.querySelector('[data-skill-token]')?.remove();
    if (!hasMeaningfulEditorContent(copy)) return '';
    return normalizeEditorText(readEditorText(copy));
  };

  const readPlainEditorBody = (editor: HTMLDivElement) => {
    if (!hasMeaningfulEditorContent(editor)) return '';
    return normalizeEditorText(readEditorText(editor));
  };

  const editorMatchesValue = (editor: HTMLDivElement, value: string) => {
    const expectedBody = inputBodyFor(value);
    const nodes = Array.from(editor.childNodes);
    let index = 0;
    if (props.selectedSkill) {
      const token = nodes[index++];
      if (!(token instanceof HTMLSpanElement)
        || token.dataset.skillToken !== 'true'
        || token.textContent !== skillPrefix
        || token.contentEditable !== 'false') return false;
    }
    if (!expectedBody) return nodes.length === index;
    return nodes.length === index + 1
      && nodes[index].nodeType === Node.TEXT_NODE
      && nodes[index].textContent === expectedBody;
  };

  const placeCaretAtEnd = (editor: HTMLDivElement) => {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const messageFromEditor = (editor: HTMLDivElement) => {
    const body = props.selectedSkill ? readEditorBody(editor) : readPlainEditorBody(editor);
    return skillPrefix ? `${skillPrefix}${body ? ` ${body}` : ''}` : body;
  };

  const updateFromEditor = (editor: HTMLDivElement) => {
    const body = props.selectedSkill ? readEditorBody(editor) : readPlainEditorBody(editor);
    const value = skillPrefix ? `${skillPrefix}${body ? ` ${body}` : ''}` : body;
    if (!body) {
      syncEditorContent(editor, value);
      placeCaretAtEnd(editor);
    }
    props.onInputChange(value);
  };

  const syncEditorContent = (editor: HTMLDivElement, value = props.input) => {
    const currentBody = props.selectedSkill ? readEditorBody(editor) : readPlainEditorBody(editor);
    const currentValue = skillPrefix ? `${skillPrefix}${currentBody ? ` ${currentBody}` : ''}` : currentBody;
    const requiresEmptyStructure = !inputBodyFor(value);
    if (currentValue === value && (!requiresEmptyStructure || editorMatchesValue(editor, value))) return;

    editor.replaceChildren();
    if (props.selectedSkill) {
      const token = document.createElement('span');
      token.className = 'skill-token';
      token.dataset.skillToken = 'true';
      token.contentEditable = 'false';
      token.textContent = skillPrefix;
      editor.append(token);
    }
    const expectedBody = inputBodyFor(value);
    if (expectedBody) editor.append(document.createTextNode(expectedBody));
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

  const insertLineBreakAtSelection = (editor: HTMLDivElement) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const lineBreak = document.createElement('br');
    const caret = document.createElement('span');
    caret.dataset.lineBreakCaret = 'true';
    caret.textContent = '\u200B';
    range.insertNode(lineBreak);
    range.setStartAfter(lineBreak);
    range.insertNode(caret);
    range.setStartAfter(caret);
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
  useEffect(() => {
    if (props.running) {
      setStopButtonVisible(true);
      setStopButtonExiting(false);
      return;
    }
    if (!stopButtonVisible) return;
    setStopButtonExiting(true);
    const timeout = window.setTimeout(() => {
      setStopButtonVisible(false);
      setStopButtonExiting(false);
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [props.running, stopButtonVisible]);
  return (
    <footer className="composer-shell">
      <div className="composer-frame">
        {commandMenuOpen && <ComposerCommandPalette commands={filteredCommands} commandIndex={commandIndex} menuRef={commandMenuRef} selectedCommandRef={selectedCommandRef} onCommandIndexChange={setCommandIndex} onRun={runCommand} />}
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
          className={`composer-input ${!props.selectedSkill && !inputBody ? 'is-empty' : ''}`}
          contentEditable={!inputDisabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label="消息输入"
          data-placeholder="向 Codex 提问，@ 添加文件，/ 调出命令"
          onInput={event => {
            setSkillPaletteOpen(false);
            const editor = event.currentTarget;
            updateFromEditor(editor);
            setCommandIndex(0);
            window.requestAnimationFrame(() => keepCaretVisible(editor));
          }}
          onContextMenu={event => {
            event.preventDefault();
            const editor = event.currentTarget;
            const selection = window.getSelection();
            const text = selection?.rangeCount && editor.contains(selection.getRangeAt(0).commonAncestorContainer)
              ? selection.toString()
              : '';
            props.onInputContextMenu(event, text, pastedText => {
              editor.focus();
              insertTextAtSelection(editor, pastedText);
            });
          }}
          onCopy={event => {
            const selection = window.getSelection();
            const text = selection?.rangeCount && event.currentTarget.contains(selection.getRangeAt(0).commonAncestorContainer)
              ? selection.toString()
              : '';
            if (!text) return;
            event.preventDefault();
            event.clipboardData.clearData();
            event.clipboardData.setData('text/plain', text);
          }}
          onPaste={event => {
            event.preventDefault();
            insertTextAtSelection(event.currentTarget, event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n'));
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
              insertLineBreakAtSelection(editor);
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
              if (props.running) {
                insertTextAtSelection(editor, '\n');
                return;
              }
              props.onSend(messageFromEditor(editor));
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
            {stopButtonVisible && <button className={`stop-button ${stopButtonExiting ? 'exiting' : ''}`} onClick={props.onStop} disabled={props.stopping} title={props.stopping ? '正在停止执行' : '停止执行'} aria-label="停止执行"><Square size={14} /><span>stop</span></button>}
            <button
              className="send-button"
              onClick={() => {
                const editor = inputRef.current;
                const message = editor ? messageFromEditor(editor) : props.input;
                props.onSend(message);
              }}
              disabled={inputDisabled || props.running || (!props.input.trim() && !props.attachments.length)}
              title="发送"
              aria-label="发送"
            ><ArrowUp size={19} /></button>
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
                  <div className="selector-menu-heading">默认权限</div>
                <button
                  className={`selector-option permission-option ${props.permissionMode === 'default' ? 'selected' : ''}`}
                  onClick={() => { props.onPermissionModeChange('default'); setOpenSelector(null); }}
                  role="option"
                  aria-selected={props.permissionMode === 'default'}
                >
                  <ShieldCheck size={16} />
                  <span><b>默认模式</b><small>影响后续请求；遵循 Codex 配置，敏感操作可能需要批准</small></span>
                  {props.permissionMode === 'default' && <Check size={16} />}
                </button>
                <button
                  className={`selector-option permission-option danger ${props.permissionMode === 'yolo' ? 'selected' : ''}`}
                  onClick={() => { props.onPermissionModeChange('yolo'); setOpenSelector(null); }}
                  role="option"
                  aria-selected={props.permissionMode === 'yolo'}
                >
                  <ShieldAlert size={16} />
                  <span><b>YOLO 模式</b><small>影响后续请求；不请求批准，并允许完整文件系统访问</small></span>
                  {props.permissionMode === 'yolo' && <Check size={16} />}
                </button>
              </div>
            )}
          </div>
        </div>
        <div className="composer-status">
          <span>{status}</span>
          <ComposerContextUsage session={props.session} disabled={disabled} contextMenuOpen={contextMenuOpen} contextUsageRef={contextUsageRef} onContextMenuOpenChange={setContextMenuOpen} onCompact={props.onCompact} />
          <span className="branch-status"><GitBranch size={14} /> 当前工作区</span>
        </div>
      </div>
    </footer>
  );
}


