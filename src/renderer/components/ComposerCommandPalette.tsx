import type { ElementType, RefObject } from 'react';

type Command = {
  id: string;
  kind: 'skill' | 'command';
  name: string;
  description: string;
  shortcut: string;
  disabled: boolean;
  icon: ElementType<{ size?: number }>;
};

type ComposerCommandPaletteProps = {
  commands: Command[];
  commandIndex: number;
  menuRef: RefObject<HTMLDivElement | null>;
  selectedCommandRef: RefObject<HTMLButtonElement | null>;
  onCommandIndexChange(index: number): void;
  onRun(index: number): void;
};

export function ComposerCommandPalette({ commands, commandIndex, menuRef, selectedCommandRef, onCommandIndexChange, onRun }: ComposerCommandPaletteProps) {
  return (
    <div className="command-menu" ref={menuRef} role="listbox" aria-label="命令和 Skills">
      {commands.map((command, index) => {
        const Icon = command.icon;
        return (
          <div className="command-menu-entry" key={command.id}>
            {(index === 0 || commands[index - 1].kind !== command.kind) && (
              <div className="command-menu-title">{command.kind === 'skill' ? 'Skills' : '命令'}</div>
            )}
            <button
              ref={index === commandIndex ? selectedCommandRef : null}
              className={`command-item ${index === commandIndex ? 'selected' : ''}`}
              onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => onCommandIndexChange(index)}
              onClick={() => onRun(index)}
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
  );
}
