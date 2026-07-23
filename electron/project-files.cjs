const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  'coverage',
  '.cache',
  'target',
  '.venv',
  'venv',
]);

const DEFAULT_LIMIT = 5000;

function shouldIgnoreDirectory(name) {
  return IGNORED_DIRECTORIES.has(name);
}

function listProjectFiles(root, options = {}) {
  const fs = options.fs;
  const path = options.path;
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : DEFAULT_LIMIT;
  if (!root || typeof root !== 'string' || !fs || !path) return [];

  const results = [];
  const stack = [''];

  while (stack.length && results.length < limit) {
    const relativeDirectory = stack.pop();
    const absoluteDirectory = relativeDirectory ? path.join(root, relativeDirectory) : root;
    let entries;
    try {
      entries = fs.readdirSync(absoluteDirectory, { withFileTypes: true });
    } catch {
      continue;
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (results.length >= limit) break;
      if (!entry?.name || entry.name === '.' || entry.name === '..') continue;
      const relativePath = relativeDirectory ? path.join(relativeDirectory, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (!shouldIgnoreDirectory(entry.name)) stack.push(relativePath);
        continue;
      }
      if (entry.isFile()) results.push(relativePath.replace(/\\/g, '/'));
    }
  }

  return results;
}

function filterProjectFiles(files, query, limit = 50) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  const max = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 50;
  if (!Array.isArray(files)) return [];
  if (!normalizedQuery) return files.slice(0, max);

  const scored = [];
  for (const file of files) {
    if (typeof file !== 'string') continue;
    const normalized = file.toLowerCase();
    const name = normalized.split('/').pop() || normalized;
    let score = -1;
    if (name === normalizedQuery) score = 300;
    else if (name.startsWith(normalizedQuery)) score = 200;
    else if (name.includes(normalizedQuery)) score = 100;
    else if (normalized.includes(normalizedQuery)) score = 50;
    if (score >= 0) scored.push({ file, score, name });
  }

  scored.sort((left, right) => right.score - left.score || left.name.localeCompare(right.name) || left.file.localeCompare(right.file));
  return scored.slice(0, max).map(item => item.file);
}

module.exports = {
  DEFAULT_LIMIT,
  IGNORED_DIRECTORIES,
  filterProjectFiles,
  listProjectFiles,
  shouldIgnoreDirectory,
};
