const path = require('path');

function runGit(spawn, args, cwd, maxBytes = Infinity) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn('git', args, {
        cwd,
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      resolve('');
      return;
    }
    let output = '';
    child.stdout.on('data', data => {
      if (Buffer.byteLength(output) >= maxBytes) return;
      output += data.toString();
    });
    child.on('error', () => resolve(''));
    child.on('close', () => resolve(output));
  });
}

function resolveChangePath(cwd, filePath) {
  const absolute = path.resolve(cwd, filePath);
  const relative = path.relative(cwd, absolute);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return { absolute, relative };
}

function truncateDiff(diff, maxBytes) {
  if (Buffer.byteLength(diff) <= maxBytes) return { diff, diffTruncated: false };
  return { diff: Buffer.from(diff).subarray(0, maxBytes).toString(), diffTruncated: true };
}

async function mapWithConcurrency(items, limit, map) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await map(items[index]);
    }
  }));
  return results;
}

function createDiffAttacher(spawn, platform = process.platform, options = {}) {
  const maxFiles = Number.isFinite(options.maxFiles) ? options.maxFiles : 8;
  const maxBytes = Number.isFinite(options.maxBytes) ? options.maxBytes : 64 * 1024;
  const concurrency = Number.isFinite(options.concurrency) ? options.concurrency : 2;
  return async function attachDiffs(cwd, files) {
    const selected = files.slice(0, maxFiles);
    const attached = await mapWithConcurrency(selected, concurrency, async file => {
      const resolved = resolveChangePath(cwd, file.path);
      if (!resolved) return file;
      let diff = await runGit(spawn, ['diff', '--no-ext-diff', '--unified=3', '--', resolved.relative], cwd, maxBytes + 1);
      // Codex may report a newly-created untracked file as an update. Ask Git
      // whether the path is tracked instead of relying on the event's kind.
      const tracked = diff || await runGit(spawn, ['ls-files', '--error-unmatch', '--', resolved.relative], cwd);
      if (!diff && !tracked) {
        const nullDevice = platform === 'win32' ? 'NUL' : '/dev/null';
        diff = await runGit(spawn, ['diff', '--no-index', '--unified=3', '--', nullDevice, resolved.absolute], cwd, maxBytes + 1);
      }
      return diff ? { ...file, ...truncateDiff(diff, maxBytes) } : file;
    });
    return [...attached, ...files.slice(maxFiles).map(file => ({ ...file, diffTruncated: true }))];
  };
}

function createDiffLoader(spawn, platform = process.platform) {
  return async (cwd, file) => createDiffAttacher(spawn, platform, { maxFiles: 1, maxBytes: 1024 * 1024, concurrency: 1 })(cwd, [file]);
}

module.exports = { createDiffAttacher, createDiffLoader, resolveChangePath, runGit, truncateDiff };
