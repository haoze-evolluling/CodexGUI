import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  ClipboardList,
  Columns3,
  GripVertical,
  Kanban,
  ListPlus,
  Pencil,
  Plus,
  Tag,
  Trash2,
  X,
} from 'lucide-react';
import {
  closestCorners,
  DndContext,
  DragCancelEvent,
  DragEndEvent,
  DragOverlay,
  DragOverEvent,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { createPortal } from 'react-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { TrelloBoard, TrelloCard, TrelloLabel, TrelloList, TrelloSubtask, ThemeChangedPayload } from '../types';

type DragData = { type: 'card' | 'list' | 'list-drop'; listId?: string; cardId?: string };
type ActiveDrag = { type: 'card' | 'list'; id: string; listId?: string };
type CardModalState = {
  cardId: string;
  listId: string;
  origin: { left: number; top: number; width: number; height: number };
  source: HTMLElement;
};
type ConfirmState = { title: string; description: string; onConfirm(): void };

const LABEL_COLORS = ['#4f8cff', '#7c5df5', '#ef6b7a', '#f39c4a', '#e2bd4f', '#31b77a', '#24a9b8', '#a78bfa'];

function createId(prefix: string) {
  const uuid = globalThis.crypto?.randomUUID?.();
  return `${prefix}-${uuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function findCard(board: TrelloBoard, cardId: string) {
  for (const list of board.lists) {
    const index = list.cards.findIndex(card => card.id === cardId);
    if (index >= 0) return { list, index, card: list.cards[index] };
  }
  return undefined;
}

function listIdFromOver(over: { id: string; data: { current: DragData | undefined } } | null) {
  if (!over) return undefined;
  const data = over.data.current;
  if (data?.listId) return data.listId;
  return typeof over.id === 'string' ? over.id : undefined;
}

function moveCard(board: TrelloBoard, cardId: string, targetListId: string, overCardId: string | undefined, insertAfter: boolean) {
  if (overCardId === cardId) return board;
  const source = findCard(board, cardId);
  const targetList = board.lists.find(list => list.id === targetListId);
  if (!source || !targetList) return board;

  const nextLists = board.lists.map(list => ({ ...list, cards: [...list.cards] }));
  const sourceList = nextLists.find(list => list.id === source.list.id)!;
  const [card] = sourceList.cards.splice(source.index, 1);
  const nextTarget = nextLists.find(list => list.id === targetListId)!;
  let targetIndex = overCardId ? nextTarget.cards.findIndex(item => item.id === overCardId) : nextTarget.cards.length;
  if (targetIndex < 0) targetIndex = nextTarget.cards.length;
  if (insertAfter && overCardId) targetIndex += 1;
  targetIndex = Math.max(0, Math.min(targetIndex, nextTarget.cards.length));

  if (source.list.id === targetListId && source.index === targetIndex) return board;
  nextTarget.cards.splice(targetIndex, 0, card);
  return { ...board, lists: nextLists };
}

function cardFor(board: TrelloBoard, listId: string, cardId: string) {
  return board.lists.find(list => list.id === listId)?.cards.find(card => card.id === cardId);
}

function LabelPill({ label, compact = false }: { label: TrelloLabel; compact?: boolean }) {
  return (
    <span className={`trello-label-pill ${compact ? 'compact' : ''}`} style={{ '--label-color': label.color } as CSSProperties}>
      <span className="trello-label-dot" />
      <span>{label.name}</span>
    </span>
  );
}

function CardPreview({ card, labels }: { card: TrelloCard; labels: TrelloLabel[] }) {
  const labelMap = new Map(labels.map(label => [label.id, label]));
  const completed = card.subtasks.filter(task => task.completed).length;
  return (
    <div className="trello-card-preview-content">
      {!!card.labelIds.length && (
        <div className="trello-card-labels">
          {card.labelIds.map(labelId => {
            const label = labelMap.get(labelId);
            return label ? <LabelPill key={label.id} label={label} compact /> : null;
          })}
        </div>
      )}
      <b className="trello-card-title">{card.title}</b>
      {card.description && <p className="trello-card-description">{card.description}</p>}
      {card.subtasks.length > 0 && (
        <span className="trello-card-checklist"><ClipboardList size={14} />{completed}/{card.subtasks.length}</span>
      )}
    </div>
  );
}

function SortableCard({
  card,
  listId,
  labels,
  origin,
  onOpen,
}: {
  card: TrelloCard;
  listId: string;
  labels: TrelloLabel[];
  origin: boolean;
  onOpen(cardId: string, element: HTMLElement): void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
    data: { type: 'card', listId, cardId: card.id } satisfies DragData,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      data-card-id={card.id}
      className={`trello-card ${isDragging ? 'is-dragging' : ''} ${origin ? 'is-card-origin' : ''}`}
      onClick={event => {
        if (!isDragging) onOpen(card.id, event.currentTarget);
      }}
      {...attributes}
      {...listeners}
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(card.id, event.currentTarget);
        }
      }}
    >
      <CardPreview card={card} labels={labels} />
    </article>
  );
}

function AddCardForm({ onSubmit, onCancel }: { onSubmit(title: string): void; onCancel(): void }) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);
  return (
    <div className="trello-add-card-form">
      <input
        ref={inputRef}
        value={title}
        placeholder="输入卡片标题"
        onChange={event => setTitle(event.target.value)}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (title.trim()) onSubmit(title);
          }
          if (event.key === 'Escape') onCancel();
        }}
      />
      <div>
        <button className="trello-primary-button" type="button" onClick={() => title.trim() && onSubmit(title)}>
          <Plus size={15} />添加卡片
        </button>
        <button className="trello-quiet-button" type="button" onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

function SortableList({
  list,
  labels,
  activeCardId,
  onListTitleChange,
  onDeleteList,
  onAddCard,
  onOpenCard,
}: {
  list: TrelloList;
  labels: TrelloLabel[];
  activeCardId?: string;
  onListTitleChange(listId: string, title: string): void;
  onDeleteList(list: TrelloList): void;
  onAddCard(listId: string, title: string): void;
  onOpenCard(cardId: string, listId: string, element: HTMLElement): void;
}) {
  const [addingCard, setAddingCard] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: list.id,
    data: { type: 'list', listId: list.id } satisfies DragData,
  });
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: `list-drop-${list.id}`,
    data: { type: 'list-drop', listId: list.id } satisfies DragData,
  });
  const listBodyRef = useRef<HTMLDivElement>(null);
  const setBodyRef = useCallback((node: HTMLDivElement | null) => {
    listBodyRef.current = node;
    setDropNodeRef(node);
  }, [setDropNodeRef]);
  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <section ref={setNodeRef} style={style} className={`trello-list ${isDragging ? 'is-list-dragging' : ''}`}>
      <header className="trello-list-header" {...attributes} {...listeners}>
        <GripVertical className="trello-drag-grip" size={16} />
        <input
          value={list.title}
          aria-label="列表标题"
          onChange={event => onListTitleChange(list.id, event.target.value)}
          onPointerDown={event => event.stopPropagation()}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
        />
        <span className="trello-list-count">{list.cards.length}</span>
        <button
          className="trello-icon-button"
          type="button"
          title="删除列表"
          aria-label={`删除列表 ${list.title}`}
          onPointerDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); onDeleteList(list); }}
        >
          <Trash2 size={15} />
        </button>
      </header>
      <div ref={setBodyRef} data-list-body={list.id} className="trello-list-body">
        <SortableContext items={list.cards.map(card => card.id)} strategy={verticalListSortingStrategy}>
          <div className="trello-card-stack">
            {list.cards.map(card => (
              <SortableCard
                key={card.id}
                card={card}
                listId={list.id}
                labels={labels}
                origin={activeCardId === card.id}
                onOpen={(cardId, element) => onOpenCard(cardId, list.id, element)}
              />
            ))}
          </div>
        </SortableContext>
        {addingCard ? (
          <AddCardForm
            onSubmit={title => { onAddCard(list.id, title); setAddingCard(false); }}
            onCancel={() => setAddingCard(false)}
          />
        ) : (
          <button className="trello-add-card-button" type="button" onClick={() => setAddingCard(true)}>
            <Plus size={16} />添加卡片
          </button>
        )}
      </div>
    </section>
  );
}

function ChecklistEditor({
  subtasks,
  onChange,
}: {
  subtasks: TrelloSubtask[];
  onChange(subtasks: TrelloSubtask[]): void;
}) {
  const [draft, setDraft] = useState('');
  const completed = subtasks.filter(task => task.completed).length;
  const addTask = () => {
    if (!draft.trim()) return;
    onChange([...subtasks, { id: createId('task'), title: draft.trim(), completed: false }]);
    setDraft('');
  };
  return (
    <section className="trello-detail-section">
      <div className="trello-detail-section-heading">
        <div>
          <b><ClipboardList size={17} />子任务</b>
          <span>{completed}/{subtasks.length} 已完成</span>
        </div>
        <div className="trello-progress-track"><span style={{ width: `${subtasks.length ? (completed / subtasks.length) * 100 : 0}%` }} /></div>
      </div>
      <div className="trello-subtask-list">
        {subtasks.map(task => (
          <div className={`trello-subtask-row ${task.completed ? 'is-complete' : ''}`} key={task.id}>
            <input
              type="checkbox"
              checked={task.completed}
              aria-label={`完成子任务 ${task.title}`}
              onChange={event => onChange(subtasks.map(item => item.id === task.id ? { ...item, completed: event.target.checked } : item))}
            />
            <input
              value={task.title}
              aria-label="子任务标题"
              onChange={event => onChange(subtasks.map(item => item.id === task.id ? { ...item, title: event.target.value } : item))}
            />
            <button className="trello-icon-button" type="button" title="删除子任务" aria-label="删除子任务" onClick={() => onChange(subtasks.filter(item => item.id !== task.id))}>
              <X size={15} />
            </button>
          </div>
        ))}
      </div>
      <div className="trello-subtask-add">
        <input
          value={draft}
          placeholder="添加子任务"
          onChange={event => setDraft(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTask(); } }}
        />
        <button className="trello-icon-button" type="button" title="添加子任务" aria-label="添加子任务" onClick={addTask}>
          <Plus size={16} />
        </button>
      </div>
    </section>
  );
}

function LabelsEditor({
  board,
  card,
  onToggle,
  onChangeLabel,
  onDeleteLabel,
  onAddLabel,
}: {
  board: TrelloBoard;
  card: TrelloCard;
  onToggle(labelId: string): void;
  onChangeLabel(labelId: string, patch: Partial<TrelloLabel>): void;
  onDeleteLabel(labelId: string): void;
  onAddLabel(name: string, color: string): void;
}) {
  const [draft, setDraft] = useState('');
  const [draftColor, setDraftColor] = useState(LABEL_COLORS[0]);
  return (
    <section className="trello-detail-section">
      <div className="trello-detail-section-heading">
        <div><b><Tag size={17} />标签</b><span>可同时选择多个标签</span></div>
      </div>
      <div className="trello-label-editor-list">
        {board.labels.map(label => {
          const selected = card.labelIds.includes(label.id);
          return (
            <div className={`trello-label-editor-row ${selected ? 'is-selected' : ''}`} key={label.id}>
              <button type="button" className="trello-label-toggle" onClick={() => onToggle(label.id)} aria-pressed={selected}>
                <span className="trello-color-swatch" style={{ backgroundColor: label.color }} />
                <span>{selected ? <Check size={13} /> : <Circle size={13} />}</span>
              </button>
              <input value={label.name} aria-label="标签名称" onChange={event => onChangeLabel(label.id, { name: event.target.value })} />
              <input className="trello-color-input" type="color" value={label.color} aria-label={`修改标签颜色 ${label.name}`} onChange={event => onChangeLabel(label.id, { color: event.target.value })} />
              <button className="trello-icon-button" type="button" title="删除标签" aria-label={`删除标签 ${label.name}`} onClick={() => onDeleteLabel(label.id)}>
                <Trash2 size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="trello-label-add-row">
        <input value={draft} placeholder="新标签名称" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (draft.trim()) { onAddLabel(draft, draftColor); setDraft(''); } } }} />
        <div className="trello-color-swatches" aria-label="选择标签颜色">
          {LABEL_COLORS.map(color => <button key={color} type="button" className={`trello-color-swatch-button ${draftColor === color ? 'is-selected' : ''}`} style={{ backgroundColor: color }} aria-label={`选择颜色 ${color}`} onClick={() => setDraftColor(color)} />)}
        </div>
        <button className="trello-icon-button trello-accent-icon" type="button" title="添加标签" aria-label="添加标签" onClick={() => { if (draft.trim()) { onAddLabel(draft, draftColor); setDraft(''); } }}>
          <Plus size={16} />
        </button>
      </div>
    </section>
  );
}

function TrelloCardDetail({
  board,
  modal,
  onChangeCard,
  onToggleLabel,
  onChangeLabel,
  onDeleteLabel,
  onAddLabel,
  onDeleteCard,
  onClose,
}: {
  board: TrelloBoard;
  modal: CardModalState;
  onChangeCard(patch: Partial<TrelloCard>): void;
  onToggleLabel(labelId: string): void;
  onChangeLabel(labelId: string, patch: Partial<TrelloLabel>): void;
  onDeleteLabel(labelId: string): void;
  onAddLabel(name: string, color: string): void;
  onDeleteCard(): void;
  onClose(): void;
}) {
  const card = cardFor(board, modal.listId, modal.cardId);
  const [expanded, setExpanded] = useState(false);
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const modalRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setExpanded(true));
    modalRef.current?.focus();
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  useEffect(() => () => { if (closeTimer.current) window.clearTimeout(closeTimer.current); }, []);
  if (!card) return null;

  function requestClose() {
    if (closing) return;
    setClosing(true);
    setExpanded(false);
    closeTimer.current = window.setTimeout(() => {
      modal.source.focus();
      onClose();
    }, 340);
  }

  const targetWidth = Math.min(760, window.innerWidth - 40);
  const targetHeight = Math.min(680, window.innerHeight - 64);
  const originScale = Math.max(0.12, Math.min(modal.origin.width / targetWidth, modal.origin.height / targetHeight));
  const modalStyle = {
    '--origin-left': `${modal.origin.left}px`,
    '--origin-top': `${modal.origin.top}px`,
    '--origin-scale': originScale,
  } as CSSProperties;

  const portalTarget = document.querySelector('.trello-app') || document.body;
  return createPortal(
    <div className={`trello-detail-layer ${expanded ? 'is-expanded' : ''} ${closing ? 'is-closing' : ''}`} onMouseDown={event => { if (event.target === event.currentTarget) requestClose(); }}>
      <div ref={modalRef} tabIndex={-1} className="trello-detail-modal" style={modalStyle} role="dialog" aria-modal="true" aria-labelledby="trello-detail-title">
        <div className="trello-detail-header">
          <div className="trello-detail-heading-icon"><Columns3 size={19} /></div>
          <div className="trello-detail-heading-copy"><span>卡片详情</span><small>{board.lists.find(list => list.id === modal.listId)?.title}</small></div>
          <button className="trello-icon-button" type="button" title="关闭详情" aria-label="关闭详情" onClick={requestClose}><X size={19} /></button>
        </div>
        <div className="trello-detail-scroll">
          <input id="trello-detail-title" className="trello-detail-title-input" value={card.title} onChange={event => onChangeCard({ title: event.target.value })} aria-label="卡片标题" />
          <textarea className="trello-detail-description" value={card.description} onChange={event => onChangeCard({ description: event.target.value })} placeholder="写下这张卡片的背景、目标或备注..." aria-label="卡片描述" />
          <div className="trello-detail-columns">
            <ChecklistEditor subtasks={card.subtasks} onChange={subtasks => onChangeCard({ subtasks })} />
            <LabelsEditor board={board} card={card} onToggle={onToggleLabel} onChangeLabel={onChangeLabel} onDeleteLabel={onDeleteLabel} onAddLabel={onAddLabel} />
          </div>
        </div>
        <div className="trello-detail-footer">
          <button className="trello-danger-button" type="button" onClick={onDeleteCard}><Trash2 size={15} />删除卡片</button>
          <button className="trello-primary-button" type="button" onClick={requestClose}><CheckCircle2 size={15} />完成</button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}

function ConfirmDialog({ confirm, onCancel }: { confirm: ConfirmState; onCancel(): void }) {
  const portalTarget = document.querySelector('.trello-app') || document.body;
  return createPortal(
    <div className="trello-confirm-layer" onMouseDown={event => { if (event.target === event.currentTarget) onCancel(); }}>
      <div className="trello-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="trello-confirm-title">
        <div className="trello-confirm-icon"><AlertTriangle size={19} /></div>
        <div><b id="trello-confirm-title">{confirm.title}</b><p>{confirm.description}</p></div>
        <div className="trello-confirm-actions">
          <button className="trello-quiet-button" type="button" onClick={onCancel}>取消</button>
          <button className="trello-danger-button" type="button" onClick={confirm.onConfirm}><Trash2 size={15} />删除</button>
        </div>
      </div>
    </div>,
    portalTarget,
  );
}

export function TrelloBoardWindow() {
  const [board, setBoard] = useState<TrelloBoard>();
  const [theme, setTheme] = useState<'light' | 'dark'>(() => document.documentElement.dataset.initialTheme === 'dark' ? 'dark' : 'light');
  const [activeDrag, setActiveDrag] = useState<ActiveDrag>();
  const [modal, setModal] = useState<CardModalState>();
  const [confirm, setConfirm] = useState<ConfirmState>();
  const [addingList, setAddingList] = useState(false);
  const [newListTitle, setNewListTitle] = useState('');
  const [saveState, setSaveState] = useState<'loading' | 'saving' | 'saved' | 'error'>('loading');
  const boardScrollRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<TrelloBoard | undefined>(undefined);
  const dragSnapshot = useRef<TrelloBoard | undefined>(undefined);
  const newListInputRef = useRef<HTMLInputElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    let cancelled = false;
    void window.codex.loadTrelloBoard().then(value => {
      if (cancelled) return;
      boardRef.current = value;
      setBoard(value);
      setSaveState('saved');
    }).catch(() => { if (!cancelled) setSaveState('error'); });
    const unsubscribe = window.codex.onThemeChanged((payload: ThemeChangedPayload) => setTheme(payload.effectiveTheme));
    return () => { cancelled = true; unsubscribe(); };
  }, []);

  useEffect(() => {
    boardRef.current = board;
    if (!board) return undefined;
    setSaveState('saving');
    const timer = window.setTimeout(() => {
      void window.codex.saveTrelloBoard(board).then(value => {
        boardRef.current = value;
        setSaveState('saved');
      }).catch(() => setSaveState('error'));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [board]);

  useEffect(() => {
    const flush = () => { if (boardRef.current) void window.codex.saveTrelloBoard(boardRef.current); };
    window.addEventListener('beforeunload', flush);
    return () => window.removeEventListener('beforeunload', flush);
  }, []);

  useEffect(() => {
    if (addingList) newListInputRef.current?.focus();
  }, [addingList]);

  useEffect(() => {
    if (!activeDrag) return undefined;
    let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    let animationFrame = 0;
    const edge = 72;
    const speed = (distance: number) => Math.max(2, Math.min(18, Math.round((edge - distance) / 3)));
    const updatePointer = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; };
    const tick = () => {
      const boardScroll = boardScrollRef.current;
      if (boardScroll) {
        const rect = boardScroll.getBoundingClientRect();
        if (pointer.x < rect.left + edge) boardScroll.scrollLeft -= speed(pointer.x - rect.left);
        if (pointer.x > rect.right - edge) boardScroll.scrollLeft += speed(rect.right - pointer.x);
      }
      const listId = activeDrag.listId;
      const listBody = listId ? document.querySelector<HTMLElement>(`[data-list-body="${listId}"]`) : null;
      if (listBody) {
        const rect = listBody.getBoundingClientRect();
        if (pointer.y < rect.top + edge) listBody.scrollTop -= speed(pointer.y - rect.top);
        if (pointer.y > rect.bottom - edge) listBody.scrollTop += speed(rect.bottom - pointer.y);
      }
      animationFrame = window.requestAnimationFrame(tick);
    };
    window.addEventListener('pointermove', updatePointer);
    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('pointermove', updatePointer);
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeDrag]);

  const updateBoard = useCallback((updater: (current: TrelloBoard) => TrelloBoard) => {
    setBoard(current => current ? updater(current) : current);
  }, []);

  const updateCard = useCallback((listId: string, cardId: string, patch: Partial<TrelloCard>) => {
    updateBoard(current => ({
      ...current,
      lists: current.lists.map(list => list.id === listId ? { ...list, cards: list.cards.map(card => card.id === cardId ? { ...card, ...patch } : card) } : list),
    }));
  }, [updateBoard]);

  const addCard = useCallback((listId: string, title: string) => {
    updateBoard(current => ({
      ...current,
      lists: current.lists.map(list => list.id === listId ? {
        ...list,
        cards: [...list.cards, { id: createId('card'), title: title.trim(), description: '', labelIds: [], subtasks: [] }],
      } : list),
    }));
  }, [updateBoard]);

  const askDeleteCard = useCallback((listId: string, cardId: string) => {
    const card = boardRef.current && cardFor(boardRef.current, listId, cardId);
    if (!card) return;
    setConfirm({
      title: '删除这张卡片？',
      description: `“${card.title}”及其子任务和标签关联将被移除。`,
      onConfirm: () => {
        updateBoard(current => ({ ...current, lists: current.lists.map(list => list.id === listId ? { ...list, cards: list.cards.filter(item => item.id !== cardId) } : list) }));
        setConfirm(undefined);
        setModal(undefined);
      },
    });
  }, [updateBoard]);

  const askDeleteList = useCallback((list: TrelloList) => {
    setConfirm({
      title: '删除这个列表？',
      description: list.cards.length ? `列表中 ${list.cards.length} 张卡片也会一起删除。` : '这个空列表会被移除。',
      onConfirm: () => {
        updateBoard(current => ({ ...current, lists: current.lists.filter(item => item.id !== list.id) }));
        setConfirm(undefined);
      },
    });
  }, [updateBoard]);

  const openCard = (cardId: string, listId: string, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setModal({ cardId, listId, origin: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, source: element });
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    if (!board) return;
    const data = active.data.current as DragData | undefined;
    if (!data?.type || data.type === 'list-drop') return;
    dragSnapshot.current = board;
    setActiveDrag({ type: data.type, id: String(active.id), listId: data.listId });
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!board || !over || active.data.current?.type !== 'card') return;
    const data = active.data.current as DragData;
    const overData = over.data.current as DragData | undefined;
    const targetListId = overData?.type === 'card' ? overData.listId : listIdFromOver(over as never);
    if (!targetListId) return;
    const overCardId = overData?.type === 'card' ? String(over.id) : undefined;
    const activeRect = active.rect.current.translated;
    const overRect = over.rect;
    const insertAfter = Boolean(activeRect && overRect && activeRect.top > overRect.top + overRect.height / 2);
    setBoard(current => current ? moveCard(current, String(active.id), targetListId, overCardId, insertAfter) : current);
    setActiveDrag(previous => previous && previous.listId !== targetListId ? { ...previous, listId: targetListId } : previous);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!board || !over) {
      dragSnapshot.current = undefined;
      setActiveDrag(undefined);
      return;
    }
    const data = active.data.current as DragData | undefined;
    if (data?.type === 'list') {
      const overListId = listIdFromOver(over as never);
      const oldIndex = board.lists.findIndex(list => list.id === active.id);
      const newIndex = board.lists.findIndex(list => list.id === overListId);
      if (oldIndex >= 0 && newIndex >= 0 && oldIndex !== newIndex) updateBoard(current => ({ ...current, lists: arrayMove(current.lists, oldIndex, newIndex) }));
    }
    dragSnapshot.current = undefined;
    setActiveDrag(undefined);
  };

  const onDragCancel = (_event: DragCancelEvent) => {
    if (dragSnapshot.current) setBoard(dragSnapshot.current);
    dragSnapshot.current = undefined;
    setActiveDrag(undefined);
  };

  const addList = () => {
    const title = newListTitle.trim();
    if (!title) return;
    updateBoard(current => ({ ...current, lists: [...current.lists, { id: createId('list'), title, cards: [] }] }));
    setNewListTitle('');
    setAddingList(false);
  };

  const activeCard = activeDrag?.type === 'card' && board ? findCard(board, activeDrag.id)?.card : undefined;
  const activeList = activeDrag?.type === 'list' && board ? board.lists.find(list => list.id === activeDrag.id) : undefined;
  const saveLabel = saveState === 'loading' ? '加载看板' : saveState === 'saving' ? '保存中' : saveState === 'error' ? '保存失败' : '已保存';

  if (!board) {
    return <div className={`trello-app theme-${theme}`}><main className="trello-loading"><Kanban size={28} /><span>{saveState === 'error' ? '看板加载失败' : '正在打开看板...'}</span></main></div>;
  }

  return (
    <div className={`trello-app theme-${theme}`}>
      <main className="trello-main">
        <header className="trello-board-header">
          <div className="trello-board-heading">
            <div className="trello-board-heading-icon"><Kanban size={20} /></div>
            <div>
              <input className="trello-board-title" value={board.title} aria-label="看板名称" onChange={event => updateBoard(current => ({ ...current, title: event.target.value }))} />
              <span>{board.lists.length} 个列表 · {board.lists.reduce((total, list) => total + list.cards.length, 0)} 张卡片</span>
            </div>
          </div>
          <div className="trello-board-actions">
            <span className={`trello-save-status ${saveState}`}><span className="trello-save-dot" />{saveLabel}</span>
            {addingList ? (
              <div className="trello-add-list-form">
                <input ref={newListInputRef} value={newListTitle} placeholder="列表名称" onChange={event => setNewListTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') addList(); if (event.key === 'Escape') setAddingList(false); }} />
                <button className="trello-primary-button" type="button" onClick={addList}><Check size={15} />添加</button>
                <button className="trello-icon-button" type="button" title="取消添加列表" aria-label="取消添加列表" onClick={() => setAddingList(false)}><X size={16} /></button>
              </div>
            ) : (
              <button className="trello-primary-button" type="button" onClick={() => setAddingList(true)}><ListPlus size={16} />添加列表</button>
            )}
          </div>
        </header>
        <div ref={boardScrollRef} className="trello-board-scroll">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDragCancel={onDragCancel}
          >
            <SortableContext items={board.lists.map(list => list.id)} strategy={horizontalListSortingStrategy}>
              <div className="trello-list-row">
                {board.lists.map(list => (
                  <SortableList
                    key={list.id}
                    list={list}
                    labels={board.labels}
                    activeCardId={modal?.cardId}
                    onListTitleChange={(listId, title) => updateBoard(current => ({ ...current, lists: current.lists.map(item => item.id === listId ? { ...item, title } : item) }))}
                    onDeleteList={askDeleteList}
                    onAddCard={addCard}
                    onOpenCard={openCard}
                  />
                ))}
                {!board.lists.length && <div className="trello-empty-board"><Columns3 size={25} /><b>从一个列表开始</b><span>添加列表，让工作流重新有序。</span></div>}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
              {activeCard ? <div className="trello-card trello-card-preview"><CardPreview card={activeCard} labels={board.labels} /></div> : activeList ? <div className="trello-list trello-list-overlay"><header className="trello-list-header"><GripVertical size={16} /><b>{activeList.title}</b><span>{activeList.cards.length}</span></header></div> : null}
            </DragOverlay>
          </DndContext>
        </div>
      </main>
      {modal && (
        <TrelloCardDetail
          board={board}
          modal={modal}
          onChangeCard={patch => updateCard(modal.listId, modal.cardId, patch)}
          onToggleLabel={labelId => updateCard(modal.listId, modal.cardId, { labelIds: board.lists.flatMap(list => list.cards).find(card => card.id === modal.cardId)?.labelIds.includes(labelId) ? board.lists.flatMap(list => list.cards).find(card => card.id === modal.cardId)!.labelIds.filter(id => id !== labelId) : [...(board.lists.flatMap(list => list.cards).find(card => card.id === modal.cardId)?.labelIds || []), labelId] })}
          onChangeLabel={(labelId, patch) => updateBoard(current => ({ ...current, labels: current.labels.map(label => label.id === labelId ? { ...label, ...patch } : label) }))}
          onDeleteLabel={labelId => updateBoard(current => ({ ...current, labels: current.labels.filter(label => label.id !== labelId), lists: current.lists.map(list => ({ ...list, cards: list.cards.map(card => ({ ...card, labelIds: card.labelIds.filter(id => id !== labelId) })) })) }))}
          onAddLabel={(name, color) => updateBoard(current => ({ ...current, labels: [...current.labels, { id: createId('label'), name: name.trim(), color }] }))}
          onDeleteCard={() => askDeleteCard(modal.listId, modal.cardId)}
          onClose={() => setModal(undefined)}
        />
      )}
      {confirm && <ConfirmDialog confirm={confirm} onCancel={() => setConfirm(undefined)} />}
    </div>
  );
}
