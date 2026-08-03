const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createTrelloStore, normalizeBoard } = require('./trello-store.cjs');

test('creates a useful default board without external state', () => {
  const board = createTrelloStore(undefined).loadBoard();
  assert.equal(board.version, 1);
  assert.equal(board.title, '我的工作流');
  assert.equal(board.lists.length, 3);
  assert.ok(board.lists.some(list => list.cards.length > 0));
  assert.ok(board.labels.length > 0);
});

test('persists and normalizes board content across store instances', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-trello-'));
  const boardFile = path.join(directory, 'trello-board.json');
  try {
    const store = createTrelloStore(boardFile);
    const saved = store.saveBoard({
      title: '  产品节奏  ',
      labels: [{ id: 'label-1', name: '  重点 ', color: '#EF6B7A' }],
      lists: [{
        id: 'list-1',
        title: '  进行中 ',
        cards: [{
          id: 'card-1',
          title: '  设计详情 ',
          description: '  说明 ',
          labelIds: ['label-1', 'missing'],
          subtasks: [{ id: 'task-1', title: '  检查交互 ', completed: true }],
        }],
      }],
    });
    assert.equal(saved.title, '产品节奏');
    assert.equal(saved.labels[0].color, '#ef6b7a');
    assert.deepEqual(saved.lists[0].cards[0].labelIds, ['label-1']);
    assert.equal(saved.lists[0].cards[0].subtasks[0].completed, true);
    assert.deepEqual(createTrelloStore(boardFile).loadBoard(), saved);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('recovers from malformed JSON and keeps intentionally empty collections', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-gui-invalid-trello-'));
  const boardFile = path.join(directory, 'trello-board.json');
  try {
    fs.writeFileSync(boardFile, '{ not json', 'utf8');
    const recovered = createTrelloStore(boardFile).loadBoard();
    assert.equal(recovered.version, 1);
    assert.ok(recovered.lists.length > 0);

    const empty = normalizeBoard({ version: 1, title: '空白看板', labels: [], lists: [], updatedAt: 3 });
    assert.deepEqual(empty.labels, []);
    assert.deepEqual(empty.lists, []);
    assert.equal(empty.updatedAt, 3);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('repairs duplicate identifiers and invalid label references', () => {
  const board = normalizeBoard({
    labels: [{ id: 'same', name: 'A', color: '#000000' }, { id: 'same', name: 'B', color: 'bad' }],
    lists: [
      { id: 'same-list', title: 'A', cards: [{ id: 'same-card', title: 'A', labelIds: ['same', 'missing'] }] },
      { id: 'same-list', title: 'B', cards: [{ id: 'same-card', title: 'B', labelIds: ['same'] }] },
    ],
  });
  assert.equal(new Set(board.labels.map(label => label.id)).size, 2);
  assert.equal(new Set(board.lists.map(list => list.id)).size, 2);
  assert.equal(new Set(board.lists.flatMap(list => list.cards.map(card => card.id))).size, 2);
  assert.deepEqual(board.lists[0].cards[0].labelIds, ['same']);
});
