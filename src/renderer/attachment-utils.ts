import type { AttachmentKind, CodexAttachment } from './types';

const imageExtensions = new Set(['bmp', 'gif', 'jpeg', 'jpg', 'png', 'webp']);
const codeExtensions = new Set(['c', 'cc', 'cpp', 'cs', 'css', 'go', 'h', 'hpp', 'html', 'java', 'js', 'json', 'jsx', 'kt', 'md', 'php', 'py', 'rb', 'rs', 'scss', 'sh', 'sql', 'swift', 'toml', 'ts', 'tsx', 'vue', 'xml', 'yaml', 'yml']);
const documentExtensions = new Set(['doc', 'docx', 'odt', 'rtf', 'txt']);
const spreadsheetExtensions = new Set(['csv', 'ods', 'xls', 'xlsx']);
const archiveExtensions = new Set(['7z', 'gz', 'rar', 'tar', 'zip']);

export const attachmentKind = (fileName: string): AttachmentKind => {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  if (imageExtensions.has(extension)) return 'image';
  if (codeExtensions.has(extension)) return 'code';
  if (extension === 'pdf') return 'pdf';
  if (documentExtensions.has(extension)) return 'document';
  if (spreadsheetExtensions.has(extension)) return 'spreadsheet';
  if (archiveExtensions.has(extension)) return 'archive';
  return 'file';
};

export const addUniqueAttachments = (current: CodexAttachment[], filePaths: string[]): CodexAttachment[] => {
  const knownPaths = new Set(current.map(attachment => attachment.path.toLowerCase()));
  const added: CodexAttachment[] = [];
  for (const filePath of filePaths) {
    const normalizedPath = filePath.toLowerCase();
    if (knownPaths.has(normalizedPath)) continue;
    knownPaths.add(normalizedPath);
    const name = filePath.split(/[/\\]/).pop() || filePath;
    added.push({ id: crypto.randomUUID(), path: filePath, name, kind: attachmentKind(name) });
  }
  return [...current, ...added];
};
