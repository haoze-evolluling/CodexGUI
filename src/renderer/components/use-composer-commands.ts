import { useEffect, useMemo, useState } from 'react';
import { AtSign, Bot, BrainCircuit, CircleGauge, Eraser, FilePlus2, ListTodo, Minimize2, Send, ShieldCheck, Sparkles, Undo2 } from 'lucide-react';
import type { CodexModel, CodexSkill } from '../types';
import { timelineOf } from '../session-model';
import type { ComposerProps } from './composer-types';

const skillScopeLabels = {
  user: '用户',
  repo: '项目',
  system: '系统',
  admin: '管理员',
} as const;

type SelectorName = 'model' | 'effort' | 'permission';

type Options = Pick<ComposerProps, 'activeSessionId' | 'collaborationModes' | 'input' | 'onChooseFiles' | 'onClearContext' | 'onCompact' | 'onInputChange' | 'onModeChange' | 'onNewConversation' | 'onRollback' | 'onSend' | 'onShowStatus' | 'onSkillSelect' | 'selectedSkill' | 'session' | 'skills'> & {
  disabled: boolean;
  selectedModel?: CodexModel;
  setOpenSelector(value: SelectorName): void;
  listMentionFiles?(cwd: string, query: string): Promise<string[]>;
  onMentionSelect?(relativePath: string): void;
};

export function useComposerCommands(options: Options) {
  const [commandIndex, setCommandIndex] = useState(0);
  const [skillPaletteOpen, setSkillPaletteOpen] = useState(false);
  const [mentionFiles, setMentionFiles] = useState<string[]>([]);
  const [mentionLoading, setMentionLoading] = useState(false);

  const commands = useMemo(() => [
    { kind: 'command' as const, id: 'continue', name: '继续', shortcut: '/continue', description: '向智能体发送 continue', icon: Send, disabled: options.disabled, run: () => options.onSend('continue') },
    { kind: 'command' as const, id: 'compact', name: '压缩上下文', shortcut: '/compact', description: '压缩当前对话，释放上下文空间', icon: Minimize2, disabled: options.disabled || !options.session?.threadId, run: options.onCompact },
    { kind: 'command' as const, id: 'undo', name: '撤销最近一轮', shortcut: '/undo', description: '从当前对话上下文中撤销最近一轮问答', icon: Undo2, disabled: options.disabled || !options.session?.threadId || !timelineOf(options.session).some(item => item.type === 'message' && item.role === 'user'), run: options.onRollback },
    { kind: 'command' as const, id: 'new', name: '新对话', shortcut: '/new', description: '在当前项目中开始新对话', icon: FilePlus2, disabled: options.disabled || !options.session?.cwd, run: options.onNewConversation },
    { kind: 'command' as const, id: 'clear', name: '清除上下文', shortcut: '/clear', description: '清空当前消息并开启新的上下文', icon: Eraser, disabled: options.disabled, run: options.onClearContext },
    { kind: 'command' as const, id: 'model', name: '选择模型', shortcut: '/model', description: '更改当前对话使用的模型', icon: Bot, disabled: options.disabled, run: () => options.setOpenSelector('model') },
    { kind: 'command' as const, id: 'reasoning', name: '推理强度', shortcut: '/reasoning', description: '调整当前模型的推理强度', icon: BrainCircuit, disabled: options.disabled || !options.selectedModel, run: () => options.setOpenSelector('effort') },
    { kind: 'command' as const, id: 'plan', name: '计划模式', shortcut: '/plan', description: '切换当前对话的计划模式', icon: ListTodo, disabled: options.disabled || !options.collaborationModes.some(mode => mode.mode === 'plan'), run: () => options.onModeChange(options.session?.collaborationMode === 'plan' ? 'default' : 'plan') },
    { kind: 'command' as const, id: 'permissions', name: '权限设置', shortcut: '/permissions', description: '选择当前对话的权限模式', icon: ShieldCheck, disabled: options.disabled, run: () => options.setOpenSelector('permission') },
    { kind: 'command' as const, id: 'status', name: '会话状态', shortcut: '/status', description: '查看线程配置和上下文用量', icon: CircleGauge, disabled: !options.activeSessionId, run: options.onShowStatus },
    { kind: 'command' as const, id: 'skills', name: 'Skills', shortcut: '/skills', description: '浏览并选择可用的 Skill', icon: Sparkles, disabled: options.disabled || !options.skills.length, run: () => setSkillPaletteOpen(true) },
    { kind: 'command' as const, id: 'mention', name: '添加文件', shortcut: '/mention', description: '选择文件并添加到当前提问', icon: AtSign, disabled: options.disabled, run: options.onChooseFiles },
  ], [options]);

  const skillCommands = useMemo(() => options.skills.map(skill => ({
    kind: 'skill' as const, id: `skill:${skill.path}`, name: skill.interface?.displayName || skill.name, shortcut: `/${skill.name}`,
    description: `${skillScopeLabels[skill.scope]} · ${skill.interface?.shortDescription || skill.shortDescription || skill.description}`,
    icon: Sparkles, disabled: options.disabled, run: () => options.onSkillSelect(skill),
  })), [options]);

  const mentionMatch = !options.input.startsWith('/')
    ? options.input.match(/(^|\s)@([^\s@]*)$/)
    : null;
  const mentionQuery = mentionMatch ? mentionMatch[2] : '';
  const mentionActive = !!mentionMatch && !!options.session?.cwd && !options.disabled;

  useEffect(() => {
    let current = true;
    if (!mentionActive || !options.session?.cwd || !options.listMentionFiles) {
      setMentionFiles([]);
      setMentionLoading(false);
      return;
    }
    setMentionLoading(true);
    options.listMentionFiles(options.session.cwd, mentionQuery).then(files => {
      if (!current) return;
      setMentionFiles(files);
      setMentionLoading(false);
    }).catch(() => {
      if (!current) return;
      setMentionFiles([]);
      setMentionLoading(false);
    });
    return () => { current = false; };
  }, [mentionActive, mentionQuery, options.listMentionFiles, options.session?.cwd]);

  const mentionCommands = useMemo(() => {
    if (!mentionActive) return [];
    if (!mentionFiles.length) {
      return [{
        kind: 'mention' as const,
        id: 'mention-empty',
        name: mentionLoading ? '正在扫描项目文件…' : (options.session?.cwd ? '没有匹配的文件' : '请先选择项目文件夹'),
        shortcut: '@',
        description: mentionLoading ? '稍候' : '试试更短的文件名关键字',
        icon: AtSign,
        disabled: true,
        run: () => undefined,
      }];
    }
    return mentionFiles.map(file => ({
      kind: 'mention' as const,
      id: `mention:${file}`,
      name: file.split('/').pop() || file,
      shortcut: `@${file}`,
      description: file,
      icon: AtSign,
      disabled: options.disabled,
      run: () => options.onMentionSelect?.(file),
    }));
  }, [mentionActive, mentionFiles, mentionLoading, options]);

  const commandQuery = options.input.startsWith('/') ? options.input.slice(1).trim().toLowerCase() : '';
  const selectedSkillPrefix = options.selectedSkill ? `/${options.selectedSkill.name}` : '';
  const selectedSkillActive = !!selectedSkillPrefix
    && (options.input === selectedSkillPrefix || options.input.startsWith(`${selectedSkillPrefix} `));
  const filteredCommands = skillPaletteOpen
    ? skillCommands
    : mentionActive
      ? mentionCommands
      : options.input.startsWith('/')
        ? [...commands, ...skillCommands].filter(command => `${command.name} ${command.shortcut} ${command.description}`.toLowerCase().includes(commandQuery))
        : [];

  const runCommand = (index: number) => {
    const command = filteredCommands[index];
    if (!command || command.disabled) return false;
    if (command.kind !== 'mention') options.onInputChange('');
    setSkillPaletteOpen(false);
    setCommandIndex(0);
    command.run();
    return true;
  };

  useEffect(() => {
    setCommandIndex(0);
  }, [mentionQuery, skillPaletteOpen, options.input]);

  return {
    commandIndex,
    commandMenuOpen: !selectedSkillActive && filteredCommands.length > 0,
    filteredCommands,
    runCommand,
    setCommandIndex,
    setSkillPaletteOpen,
    skillPaletteOpen,
    mentionActive,
  };
}
