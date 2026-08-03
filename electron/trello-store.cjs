const fs = require('fs');
const path = require('path');

const BOARD_VERSION = 1;
const DEFAULT_LABEL_COLORS = ['#4f8cff', '#7c5df5', '#ef6b7a', '#f39c4a', '#e2bd4f', '#31b77a', '#24a9b8', '#a78bfa'];

function defaultBoard() {
  return {
    version: BOARD_VERSION,
    title: '我的工作流',
    labels: [
      { id: 'label-design', name: '设计', color: '#7c5df5' },
      { id: 'label-focus', name: '重点', color: '#ef6b7a' },
      { id: 'label-review', name: '待评审', color: '#e2bd4f' },
    ],
    lists: [
      {
        id: 'list-backlog',
        title: '待处理',
        cards: [
          {
            id: 'card-home',
            title: '整理本周工作重点',
            description: '把零散事项收拢成一条清晰的执行路径。',
            labelIds: ['label-focus'],
            subtasks: [
              { id: 'task-home-1', title: '确认本周目标', completed: true },
              { id: 'task-home-2', title: '拆分下一步行动', completed: false },
            ],
          },
          {
            id: 'card-research',
            title: '收集用户反馈',
            description: '记录最常出现的问题和值得保留的细节。',
            labelIds: ['label-review'],
            subtasks: [],
          },
        ],
      },
      {
        id: 'list-progress',
        title: '进行中',
        cards: [
          {
            id: 'card-interface',
            title: '打磨看板交互',
            description: '让每一次移动、展开和编辑都保持清晰而有节奏。',
            labelIds: ['label-design', 'label-focus'],
            subtasks: [
              { id: 'task-interface-1', title: '检查拖拽反馈', completed: true },
              { id: 'task-interface-2', title: '完善卡片详情', completed: false },
              { id: 'task-interface-3', title: '确认浅色主题', completed: false },
            ],
          },
        ],
      },
      {
        id: 'list-done',
        title: '已完成',
        cards: [
          {
            id: 'card-setup',
            title: '建立工作流结构',
            description: '基础列表已经准备好，可以直接开始安排工作。',
            labelIds: [],
            subtasks: [],
          },
        ],
      },
    ],
    updatedAt: Date.now(),
  };
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function color(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

function uniqueId(value, fallback, used) {
  const candidate = text(value, fallback);
  if (!used.has(candidate)) {
    used.add(candidate);
    return candidate;
  }
  let suffix = 2;
  let next = `${candidate}-${suffix}`;
  while (used.has(next)) next = `${candidate}-${++suffix}`;
  used.add(next);
  return next;
}

function normalizeLabels(value) {
  if (!Array.isArray(value)) return defaultBoard().labels;
  const used = new Set();
  return value.map((item, index) => {
    const id = uniqueId(item?.id, `label-${index + 1}`, used);
    return {
      id,
      name: text(item?.name, '未命名标签'),
      color: color(item?.color, DEFAULT_LABEL_COLORS[index % DEFAULT_LABEL_COLORS.length]),
    };
  });
}

function normalizeSubtasks(value, cardIndex) {
  if (!Array.isArray(value)) return [];
  const used = new Set();
  return value.map((item, index) => ({
    id: uniqueId(item?.id, `task-${cardIndex + 1}-${index + 1}`, used),
    title: text(item?.title, '未命名子任务'),
    completed: item?.completed === true,
  }));
}

function normalizeCards(value, labels, listIndex, sharedIds) {
  if (!Array.isArray(value)) return [];
  const knownLabels = new Set(labels.map(label => label.id));
  const used = sharedIds || new Set();
  return value.map((item, index) => ({
    id: uniqueId(item?.id, `card-${listIndex + 1}-${index + 1}`, used),
    title: text(item?.title, '未命名卡片'),
    description: typeof item?.description === 'string' ? item.description.trim() : '',
    labelIds: Array.isArray(item?.labelIds)
      ? [...new Set(item.labelIds.filter(labelId => typeof labelId === 'string' && knownLabels.has(labelId)))]
      : [],
    subtasks: normalizeSubtasks(item?.subtasks, index),
  }));
}

function normalizeBoard(value) {
  const fallback = defaultBoard();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  const labels = normalizeLabels(value.labels);
  const usedListIds = new Set();
  const usedCardIds = new Set();
  const sourceLists = Array.isArray(value.lists) ? value.lists : fallback.lists;
  const lists = sourceLists.map((item, index) => ({
      id: uniqueId(item?.id, `list-${index + 1}`, usedListIds),
      title: text(item?.title, '未命名列表'),
      cards: normalizeCards(item?.cards, labels, index, usedCardIds),
    }));
  return {
    version: BOARD_VERSION,
    title: text(value.title, fallback.title),
    labels,
    lists,
    updatedAt: typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
  };
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporaryPath, filePath);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function createTrelloStore(boardFile) {
  return {
    loadBoard() {
      return normalizeBoard(boardFile ? readJson(boardFile, null) : null);
    },
    saveBoard(board) {
      const normalized = normalizeBoard({ ...board, updatedAt: Date.now() });
      if (boardFile) writeJson(boardFile, normalized);
      return normalized;
    },
  };
}

module.exports = { BOARD_VERSION, createTrelloStore, defaultBoard, normalizeBoard };
