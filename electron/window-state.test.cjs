const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachWindowState,
  normalizeWindowState,
  normalizeWindowStates,
  restoreWindowState,
} = require('./window-state.cjs');

test('normalizes valid window states and rejects malformed states', () => {
  assert.deepEqual(normalizeWindowState({ x: 1.4, y: -2.6, width: 1000.2, height: 700.8, maximized: true }), {
    x: 1, y: -3, width: 1000, height: 701, maximized: true,
  });
  assert.equal(normalizeWindowState({ x: 0, y: 0, width: 0, height: 100 }), undefined);
  assert.deepEqual(normalizeWindowStates({ main: { x: 0, y: 0, width: 100, height: 100 }, trello: null }), {
    main: { x: 0, y: 0, width: 100, height: 100, maximized: false },
  });
});

test('restores a saved window inside the matching display work area', () => {
  const left = { id: 'left', workArea: { x: -1200, y: 0, width: 1200, height: 900 } };
  const right = { id: 'right', workArea: { x: 0, y: 0, width: 1600, height: 1000 } };
  assert.deepEqual(restoreWindowState({ x: -1100, y: 100, width: 1000, height: 700, maximized: true }, {
    defaultBounds: { x: 0, y: 0, width: 1280, height: 800 },
    minWidth: 900,
    minHeight: 600,
    displays: [left, right],
    primaryDisplay: right,
  }), {
    bounds: { x: -1100, y: 100, width: 1000, height: 700 },
    maximized: true,
  });
});

test('moves an off-screen window back into the primary display and clamps its size', () => {
  const display = { id: 'primary', workArea: { x: 0, y: 0, width: 1280, height: 720 } };
  assert.deepEqual(restoreWindowState({ x: 5000, y: -500, width: 2400, height: 1600, maximized: false }, {
    defaultBounds: { x: 0, y: 0, width: 1280, height: 800 },
    minWidth: 900,
    minHeight: 600,
    displays: [display],
    primaryDisplay: display,
  }), {
    bounds: { x: 0, y: 0, width: 1280, height: 720 },
    maximized: false,
  });
});

test('saves the normal bounds on close and preserves other window states', () => {
  const listeners = new Map();
  const window = {
    getNormalBounds: () => ({ x: 20, y: 30, width: 900, height: 600 }),
    isDestroyed: () => false,
    isFullScreen: () => false,
    isMaximized: () => true,
    on: (event, handler) => listeners.set(event, handler),
  };
  const settings = { windowStates: { trello: { x: 1, y: 2, width: 3, height: 4, maximized: false } } };
  const saved = [];
  const store = {
    loadSettings: () => settings,
    saveSettings: value => { saved.push(value); settings.windowStates = value.windowStates; },
  };
  attachWindowState(window, { key: 'main', store, saveDelayMs: 100000 });
  listeners.get('close')();
  assert.deepEqual(saved, [{ windowStates: {
    main: { x: 20, y: 30, width: 900, height: 600, maximized: true },
    trello: { x: 1, y: 2, width: 3, height: 4, maximized: false },
  } }]);
});
