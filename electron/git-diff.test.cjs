const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const path = require('path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const { createDiffAttacher, resolveChangePath } = require('./git-diff.cjs');

function gitSpawn(outputs, calls) {
  return (_, args) => {
    calls.push(args);
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    const output = outputs.shift() || '';
    queueMicrotask(() => {
      child.stdout.end(output);
      child.emit('close', 0);
    });
    return child;
  };
}

test('resolves repository-relative changed files', () => {
  const cwd = path.resolve('project');
  assert.deepEqual(resolveChangePath(cwd, 'src/app.ts'), {
    absolute: path.join(cwd, 'src', 'app.ts'),
    relative: path.join('src', 'app.ts'),
  });
});

test('rejects change paths outside the repository', () => {
  const cwd = path.resolve('project');
  assert.equal(resolveChangePath(cwd, '../outside.ts'), null);
  assert.equal(resolveChangePath(cwd, '.'), null);
});

test('truncates oversized diffs and marks omitted files for on-demand loading', async () => {
  const attachDiffs = createDiffAttacher(gitSpawn(['x'.repeat(32), 'x'.repeat(32)], []), 'win32', { maxFiles: 1, maxBytes: 8, concurrency: 1 });
  const files = await attachDiffs('C:\\repo', [{ path: 'a.txt', kind: 'update' }, { path: 'b.txt', kind: 'update' }]);
  assert.equal(files[0].diffTruncated, true);
  assert.equal(Buffer.byteLength(files[0].diff), 8);
  assert.deepEqual(files[1], { path: 'b.txt', kind: 'update', diffTruncated: true });
});

test('creates a diff for an untracked file reported as an update', async () => {
  const calls = [];
  const attachDiffs = createDiffAttacher(gitSpawn([
    '',
    '',
    'diff --git a/new.txt b/new.txt\nnew file mode 100644\n+contents\n',
  ], calls), 'win32');

  const [file] = await attachDiffs('C:\\repo', [{ path: 'new.txt', kind: 'update' }]);

  assert.match(file.diff, /new file mode/);
  assert.deepEqual(calls[1], ['ls-files', '--error-unmatch', '--', 'new.txt']);
  assert.deepEqual(calls[2], ['diff', '--no-index', '--unified=3', '--', 'NUL', path.join('C:\\repo', 'new.txt')]);
});
