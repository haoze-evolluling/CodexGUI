const assert = require('node:assert/strict');
const path = require('path');
const test = require('node:test');
const { resolveChangePath } = require('./git-diff.cjs');

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
