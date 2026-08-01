const fs = require('fs');
const path = require('path');
const { enrichSessionWithCodexTranscript } = require('./codex-history-merge.cjs');
const { parseSessionLines } = require('./codex-history-transcript.cjs');

function readSessionFile(filePath) {
  try { return fs.readFileSync(filePath, 'utf8').split(/\r?\n/); } catch { return null; }
}

function parseSessionFile(filePath) {
  const lines = readSessionFile(filePath);
  return lines ? parseSessionLines(lines) : null;
}

async function sessionFilesAsync(root) {
  const files = [];
  const visit = async directory => {
    let entries;
    try { entries = await fs.promises.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(filePath);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(filePath);
    }
  };
  await visit(root);
  return files;
}

async function readSessionFileAsync(filePath) {
  try { return (await fs.promises.readFile(filePath, 'utf8')).split(/\r?\n/); } catch { return null; }
}

async function loadCodexSession(codexHome, threadId, directory = 'sessions') {
  if (typeof threadId !== 'string' || !threadId) return null;
  const sessionsRoot = path.join(codexHome, directory);
  const fragments = [];
  for (const filePath of await sessionFilesAsync(sessionsRoot)) {
    const lines = await readSessionFileAsync(filePath);
    if (!lines || parseSessionLines(lines)?.threadId !== threadId) continue;
    let modified = 0;
    try { modified = (await fs.promises.stat(filePath)).mtimeMs; } catch { /* Keep timestamp ordering when metadata is unavailable. */ }
    fragments.push({ lines, modified });
  }
  if (!fragments.length) return null;

  const seen = new Set();
  const records = [];
  let order = 0;
  for (const fragment of fragments) {
    fragment.lines.forEach((line, lineIndex) => {
      if (!line.trim() || seen.has(line)) return;
      seen.add(line);
      let timestamp = Number.NaN;
      try { timestamp = Date.parse(JSON.parse(line).timestamp); } catch { /* parseSessionLines will ignore malformed records. */ }
      records.push({ line, timestamp, modified: fragment.modified, lineIndex, order: order++ });
    });
  }
  records.sort((left, right) => {
    const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : left.modified;
    const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : right.modified;
    return leftTime - rightTime || left.modified - right.modified || left.lineIndex - right.lineIndex || left.order - right.order;
  });
  return parseSessionLines(records.map(record => record.line));
}

module.exports = { enrichSessionWithCodexTranscript, loadCodexSession, parseSessionFile };
