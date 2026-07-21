import { useMemo, useState } from 'react';
import { AtSign, Bot, BrainCircuit, CircleGauge, Eraser, FilePlus2, ListTodo, Minimize2, Send, ShieldCheck, Sparkles } from 'lucide-react';
import type { CodexModel, CodexSkill } from '../types';
import type { ComposerProps } from './composer-types';

type SelectorName = 'model' | 'effort' | 'permission' | null;

const skillScopeLabels: Record<CodexSkill['scope'], string> = {
  repo: '项目', user: '用户', admin: '管理员', system: '系统',
};

type Options = Pick<ComposerProps, 'activeSessionId' | 'collaborationModes' | 'input' | 'models' | 'onChooseFiles' | 'onClearContext' | 'onCompact' | 'onInputChange' | 'onModeChange' | 'onNewConversation' | 'onSend' | 'onShowStatus' | 'onSkillSelect' | 'session' | 'skills'> & {
  disabled: boolean;
  selectedModel?: CodexModel;
  setOpenSelector(value: SelectorName): void;
};

export function useComposerCommands(options: Options) {
  const [commandIndex, setCommandIndex] = useState(0);
  const [skillPaletteOpen, setSkillPaletteOpen] = useState(false);
  const commands = useMemo(() => [
    { kind: 'command' as const, id: 'continue', name: '继续', shortcut: '/continue', description: '向智能体发送 continue', icon: Send, disabled: options.disabled, run: () => options.onSend('continue') },
    { kind: 'command' as const, id: 'compact', name: '压缩上下文', shortcut: '/compact', description: '压缩当前对话，释放上下文空间', icon: Minimize2, disabled: options.disabled || !options.session?.threadId, run: options.onCompact },
    { kind: 'command' as const, id: 'new', name: '新对话', shortcut: '/new', description: '在当前项目中开始新对话', icon: FilePlus2, disabled: options.disabled || !options.session?.cwd, run: options.onNewConversation },
    { kind: 'command' as const, id: 'clear', name: '清除上下文', shortcut: '/clear', description: '清空当前消息并开启新的上下文', icon: Eraser, disabled: options.disabled, run: options.onClearContext },
    { kind: 'command' as const, id: 'model', name: '选择模型', shortcut: '/model', description: '更改当前对话使用的模型', icon: Bot, disabled: options.disabled || !options.models.length, run: () => options.setOpenSelector('model') },
    { kind: 'command' as const, id: 'reasoning', name: '推理强度', shortcut: '/reasoning', description: '调整当前模型的推理强度', icon: BrainCircuit, disabled: options.disabled || !options.selectedModel, run: () => options.setOpenSelector('effort') },
    { kind: 'command' as const, id: 'plan', name: '计划模式', shortcut: '/plan', description: '切换当前对话的计划模式', icon: ListTodo, disabled: options.disabled || !options.collaborationModes.some(mode => mode.mode === 'plan'), run: () => options.onModeChange(options.session?.collaborationMode === 'plan' ? 'default' : 'plan') },
    { kind: 'command' as const, id: 'permissions', name: '权限设置', shortcut: '/permissions', description: '选择当前对话的权限模式', icon: ShieldCheck, disabled: options.disabled, run: () => options.setOpenSelector('permission') },
    { kind: 'command' as const, id: 'status', name: '会话状态', shortcut: '/status', description: '查看线程配置和上下文用量', icon: CircleGauge, disabled: !options.activeSessionId, run: options.onShowStatus },
    { kind: 'command' as const, id: 'skills', name: 'Skills', shortcut: '/skills', description: '浏览并选择可用的 Skill', icon: Sparkles, disabled: options.disabled || !options.skills.length, run: () => setSkillPaletteOpen(true) },
    { kind: 'command' as const, id: 'mention', name: '添加文件', shortcut: '/mention', description: '选择文件并添加到当前提问', icon: AtSign, disabled: options.disabled, run: options.onChooseFiles },
  ], [options]);
  const skillCommands = useMemo(() => options.skills.map(skill => ({
    kind: 'skill' as const, id: `skill:${skill.path}`, name: skill.interface?.displayName || skill.name, shortcut: `$${skill.name}`,
    description: `${skillScopeLabels[skill.scope]} · ${skill.interface?.shortDescription || skill.shortDescription || skill.description}`,
    icon: Sparkles, disabled: options.disabled, run: () => options.onSkillSelect(skill),
  })), [options]);
  const commandQuery = options.input.startsWith('/') ? options.input.slice(1).trim().toLowerCase() : '';
  const filteredCommands = skillPaletteOpen
    ? skillCommands
    : options.input.startsWith('/')
      ? [...commands, ...skillCommands].filter(command => `${command.name} ${command.shortcut} ${command.description}`.toLowerCase().includes(commandQuery))
      : [];
  const runCommand = (index: number) => {
    const command = filteredCommands[index];
    if (!command || command.disabled) return false;
    options.onInputChange('');
    setSkillPaletteOpen(false);
    setCommandIndex(0);
    command.run();
    return true;
  };

  return { commandIndex, commandMenuOpen: filteredCommands.length > 0, filteredCommands, runCommand, setCommandIndex, setSkillPaletteOpen, skillPaletteOpen };
}
