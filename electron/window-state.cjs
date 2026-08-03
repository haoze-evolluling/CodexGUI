const WINDOW_STATE_KEYS = ['main', 'trello'];
const SAVE_DELAY_MS = 200;

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function normalizeWindowState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const width = finiteNumber(value.width);
  const height = finiteNumber(value.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(width),
    height: Math.round(height),
    maximized: value.maximized === true,
  };
}

function normalizeWindowStates(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(WINDOW_STATE_KEYS.flatMap(key => {
    const normalized = normalizeWindowState(value[key]);
    return normalized ? [[key, normalized]] : [];
  }));
}

function intersects(first, second) {
  return first.x < second.x + second.width
    && first.x + first.width > second.x
    && first.y < second.y + second.height
    && first.y + first.height > second.y;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function workAreaOf(display) {
  const workArea = display?.workArea;
  if (!workArea) return undefined;
  const x = finiteNumber(workArea.x);
  const y = finiteNumber(workArea.y);
  const width = finiteNumber(workArea.width);
  const height = finiteNumber(workArea.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  return { x, y, width, height };
}

function restoreWindowState(savedState, { defaultBounds, minWidth, minHeight, displays = [], primaryDisplay } = {}) {
  const normalized = normalizeWindowState(savedState);
  const fallback = normalizeWindowState(defaultBounds) || { x: 0, y: 0, width: 1280, height: 800, maximized: false };
  const requested = normalized || fallback;
  const validDisplays = displays.map(display => ({ display, workArea: workAreaOf(display) })).filter(item => item.workArea);
  const matching = validDisplays.find(item => intersects(requested, item.workArea));
  const primary = validDisplays.find(item => item.display?.id === primaryDisplay?.id)
    || validDisplays[0];
  const workArea = (matching || primary)?.workArea;
  if (!workArea) return { bounds: requested, maximized: Boolean(normalized?.maximized) };

  const minimumWidth = Math.max(1, Math.round(finiteNumber(minWidth) || 1));
  const minimumHeight = Math.max(1, Math.round(finiteNumber(minHeight) || 1));
  const width = clamp(Math.round(requested.width), Math.min(minimumWidth, workArea.width), workArea.width);
  const height = clamp(Math.round(requested.height), Math.min(minimumHeight, workArea.height), workArea.height);
  const x = clamp(Math.round(requested.x), workArea.x, workArea.x + workArea.width - width);
  const y = clamp(Math.round(requested.y), workArea.y, workArea.y + workArea.height - height);
  return {
    bounds: { x, y, width, height },
    maximized: Boolean(normalized?.maximized),
  };
}

function attachWindowState(window, { key, store, saveDelayMs = SAVE_DELAY_MS } = {}) {
  let timer;

  const save = () => {
    timer = undefined;
    if (!window || (typeof window.isDestroyed === 'function' && window.isDestroyed())) return;
    const bounds = typeof window.getNormalBounds === 'function' ? window.getNormalBounds() : window.getBounds();
    const normalized = normalizeWindowState({
      ...bounds,
      maximized: typeof window.isMaximized === 'function' && window.isMaximized(),
    });
    if (!normalized || !store || !key) return;
    const settings = store.loadSettings();
    store.saveSettings({
      windowStates: {
        ...normalizeWindowStates(settings.windowStates),
        [key]: normalized,
      },
    });
  };

  const scheduleSave = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, saveDelayMs);
  };

  const saveBounds = () => {
    if (typeof window.isFullScreen === 'function' && window.isFullScreen()) return;
    scheduleSave();
  };

  window.on('move', saveBounds);
  window.on('resize', saveBounds);
  window.on('maximize', scheduleSave);
  window.on('unmaximize', scheduleSave);
  window.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
  window.on('closed', () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  });

  return { save, scheduleSave };
}

module.exports = {
  attachWindowState,
  normalizeWindowState,
  normalizeWindowStates,
  restoreWindowState,
};
