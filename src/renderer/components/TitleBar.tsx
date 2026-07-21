import { Maximize2, Minus, X } from 'lucide-react';
import logoUrl from '../../../CodexGUI-logo.svg';

export function TitleBar() {
  return (
    <div className="title-bar">
      <div className="title-bar-brand">
        <img src={logoUrl} alt="" />
        <span>Codex GUI</span>
      </div>
      <div className="window-controls">
        <button type="button" onClick={() => window.codex.minimizeWindow()} title="最小化" aria-label="最小化">
          <Minus size={16} strokeWidth={1.8} />
        </button>
        <button type="button" onClick={() => window.codex.toggleMaximizeWindow()} title="最大化或还原" aria-label="最大化或还原">
          <Maximize2 size={14} strokeWidth={1.8} />
        </button>
        <button className="window-close" type="button" onClick={() => window.codex.closeWindow()} title="关闭" aria-label="关闭">
          <X size={17} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
