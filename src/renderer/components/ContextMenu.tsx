import { type ReactNode, useEffect, useRef } from 'react';

export type ContextMenuItem = {
  label: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  onSelect(): void;
};

type ContextMenuProps = {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose(): void;
};

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = () => onClose();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.min(x, window.innerWidth - width - 8)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - height - 8)}px`;
  }, [x, y]);

  return (
    <div className="context-menu" ref={menuRef} role="menu" style={{ left: x, top: y }} onPointerDown={event => event.stopPropagation()}>
      {items.map(item => (
        <button
          className={item.danger ? 'danger' : undefined}
          disabled={item.disabled}
          key={item.label}
          role="menuitem"
          onClick={() => {
            if (item.disabled) return;
            onClose();
            item.onSelect();
          }}
        >
          <span className="context-menu-icon" aria-hidden="true">{item.icon}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}
