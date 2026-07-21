import { AlertTriangle, Info } from 'lucide-react';

export type AppDialogState = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm(): void;
};

export function AppDialog({ dialog, onClose }: { dialog: AppDialogState; onClose(): void }) {
  const Icon = dialog.danger ? AlertTriangle : Info;
  return (
    <div className="app-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className="app-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-description"
        onKeyDown={event => { if (event.key === 'Escape') onClose(); }}
      >
        <div className={`app-dialog-icon ${dialog.danger ? 'danger' : ''}`}><Icon size={19} /></div>
        <div className="app-dialog-copy">
          <b id="app-dialog-title">{dialog.title}</b>
          <p id="app-dialog-description">{dialog.description}</p>
        </div>
        <div className="app-dialog-actions">
          {dialog.cancelLabel && <button onClick={onClose}>{dialog.cancelLabel}</button>}
          <button autoFocus className={dialog.danger ? 'danger' : 'primary'} onClick={dialog.onConfirm}>{dialog.confirmLabel || '确定'}</button>
        </div>
      </div>
    </div>
  );
}
