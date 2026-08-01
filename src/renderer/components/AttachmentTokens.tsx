import { Archive, File, FileCode2, FileSpreadsheet, FileText, Image, X } from 'lucide-react';
import type { CodexAttachment } from '../types';

const icons = {
  image: Image,
  code: FileCode2,
  pdf: FileText,
  document: FileText,
  spreadsheet: FileSpreadsheet,
  archive: Archive,
  file: File,
};

export function AttachmentTokens({ attachments, onRemove }: {
  attachments: CodexAttachment[];
  onRemove?(id: string): void;
}) {
  let imageNumber = 0;
  return (
    <div className={`attachment-tokens ${onRemove ? 'editable' : ''}`} aria-label="附件">
      {attachments.map(attachment => {
        const Icon = icons[attachment.kind];
        const label = attachment.kind === 'image' ? `Image #${++imageNumber}` : attachment.name;
        return onRemove ? (
          <button
            type="button"
            className={`attachment-token ${attachment.kind}`}
            key={attachment.id}
            title={attachment.path}
            onClick={event => event.currentTarget.focus()}
            onKeyDown={event => {
              if (event.key !== 'Backspace' && event.key !== 'Delete') return;
              event.preventDefault();
              onRemove(attachment.id);
            }}
          >
            <Icon size={14} />
            <span>[{label}]</span>
            <X
              size={13}
              aria-label={`删除 ${label}`}
              onClick={event => { event.stopPropagation(); onRemove(attachment.id); }}
            />
          </button>
        ) : (
          <span className={`attachment-token ${attachment.kind}`} key={attachment.id} title={attachment.name}>
            <Icon size={14} />
            <span>[{label}]</span>
          </span>
        );
      })}
    </div>
  );
}
