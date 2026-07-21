import { AlertTriangle, Info } from 'lucide-react';
import { useEffect } from 'react';

export type AppDialogState = {
  title: string;
  description?: string;
  details?: { label: string; value: string }[];
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm(): void;
};

export function AppDialog({ dialog, onClose }: { dialog: AppDialogState; onClose(): void }) {
  const Icon = dialog.danger ? AlertTriangle : Info;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Enter' && !event.isComposing) {
        event.preventDefault();
        dialog.onConfirm();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialog, onClose]);

  return (
    <div className="app-dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        className="app-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-description"
      >
        <div className={`app-dialog-icon ${dialog.danger ? 'danger' : ''}`}><Icon size={19} /></div>
        <div className="app-dialog-copy">
          <b id="app-dialog-title">{dialog.title}</b>
          {dialog.description && <p id="app-dialog-description">{dialog.description}</p>}
          {!!dialog.details?.length && (
            <dl className="app-dialog-details" id={dialog.description ? undefined : 'app-dialog-description'}>
              {dialog.details.map(detail => (
                <div key={detail.label}><dt>{detail.label}</dt><dd title={detail.value}>{detail.value}</dd></div>
              ))}
            </dl>
          )}
        </div>
        <div className="app-dialog-actions">
          {dialog.cancelLabel && <button onClick={onClose}>{dialog.cancelLabel}</button>}
          <button autoFocus className={dialog.danger ? 'danger' : 'primary'} onClick={dialog.onConfirm}>{dialog.confirmLabel || '确定'}</button>
        </div>
      </div>
    </div>
  );
}
