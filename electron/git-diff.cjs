const path = require('path');

function runGit(spawn, args, cwd) {
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
    child.stdout.on('data', data => { output += data.toString(); });
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

function createDiffAttacher(spawn, platform = process.platform) {
  return async function attachDiffs(cwd, files) {
    return Promise.all(files.map(async file => {
      const resolved = resolveChangePath(cwd, file.path);
      if (!resolved) return file;
      let diff = await runGit(spawn, ['diff', '--no-ext-diff', '--unified=3', '--', resolved.relative], cwd);
      if (!diff && file.kind === 'add') {
        const nullDevice = platform === 'win32' ? 'NUL' : '/dev/null';
        diff = await runGit(spawn, ['diff', '--no-index', '--unified=3', '--', nullDevice, resolved.absolute], cwd);
      }
      return diff ? { ...file, diff } : file;
    }));
  };
}

module.exports = { createDiffAttacher, resolveChangePath, runGit };
