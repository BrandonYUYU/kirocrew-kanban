// Kanban — a KiroCrew app UI (build-free ESM module).
//
// Loaded dynamically by AppHost via import('/apps/kanban/ui/index.mjs').
// React, the app SDK, and icons are resolved from the host's import map
// (window.__kirocrew_modules), so this file ships as-is with no npm/vite build.

const React = window.__kirocrew_modules.react
const { useAppApi } = window.__kirocrew_modules['@kirocrew/app-sdk']
const _icons = window.__kirocrew_modules['lucide-react'] || {}

const { useState, useEffect, useCallback, createElement: h } = React

// Defensive icon resolver: lucide-react renames/drops icons between versions
// (e.g. `Trello` was removed). A missing icon must never crash the whole board
// with React error #130 ("element type is undefined"), so fall back to a tiny
// inline SVG square for any name the host import map does not expose.
function icon(...names) {
  for (const n of names) {
    if (typeof _icons[n] === 'function' || typeof _icons[n] === 'object') return _icons[n]
  }
  return function Fallback({ size = 16 }) {
    return h('svg', {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
      stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
    }, h('rect', { x: 3, y: 3, width: 18, height: 18, rx: 2 }))
  }
}

const BoardIcon = icon('LayoutGrid', 'Columns3', 'Kanban', 'Trello')
const Plus = icon('Plus')
const Trash2 = icon('Trash2', 'Trash')
const ChevronLeft = icon('ChevronLeft')
const ChevronRight = icon('ChevronRight')
const RefreshCw = icon('RefreshCw', 'RotateCw')
const X = icon('X')

const COLUMN_ORDER = ['todo', 'doing', 'done']
const PRIORITY_COLORS = {
  high: 'var(--danger, #e5484d)',
  medium: 'var(--warning, #f5a623)',
  low: 'var(--muted, #8b8b8b)',
}

function StatCard({ label, value, accent }) {
  return h(
    'div',
    {
      className:
        'border border-border bg-card rounded-lg px-4 py-3 shadow-sm' +
        (accent ? ' ring-1 ring-accent/30' : ''),
    },
    h('div', { className: 'text-muted text-xs uppercase tracking-wide' }, label),
    h('div', { className: 'text-text-strong text-xl font-bold mt-0.5' }, String(value))
  )
}

function PriorityDot({ priority }) {
  return h('span', {
    title: priority,
    style: {
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: 999,
      background: PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium,
      flex: '0 0 auto',
    },
  })
}

function CardView({ card, colIndex, onEdit, onMove, onDelete }) {
  return h(
    'div',
    {
      className:
        'border border-border bg-card rounded-md p-3 shadow-sm mb-2 cursor-pointer hover:border-border-strong transition-all',
      onClick: () => onEdit(card),
    },
    h(
      'div',
      { className: 'flex items-start gap-2' },
      h(PriorityDot, { priority: card.priority }),
      h('div', { className: 'text-text-strong text-sm font-medium flex-1 min-w-0 break-words' }, card.title)
    ),
    card.description
      ? h('div', { className: 'text-muted text-xs mt-1.5 line-clamp-3 whitespace-pre-wrap' }, card.description)
      : null,
    h(
      'div',
      { className: 'flex items-center justify-between mt-2.5' },
      h(
        'div',
        { className: 'flex items-center gap-1' },
        colIndex > 0
          ? h(
              'button',
              {
                className:
                  'p-1 rounded text-muted hover:text-text hover:bg-hover transition-all',
                title: 'Move left',
                onClick: (e) => {
                  e.stopPropagation()
                  onMove(card, COLUMN_ORDER[colIndex - 1])
                },
              },
              h(ChevronLeft, { size: 15 })
            )
          : null,
        colIndex < COLUMN_ORDER.length - 1
          ? h(
              'button',
              {
                className:
                  'p-1 rounded text-muted hover:text-text hover:bg-hover transition-all',
                title: 'Move right',
                onClick: (e) => {
                  e.stopPropagation()
                  onMove(card, COLUMN_ORDER[colIndex + 1])
                },
              },
              h(ChevronRight, { size: 15 })
            )
          : null
      ),
      h(
        'button',
        {
          className: 'p-1 rounded text-muted hover:text-danger hover:bg-hover transition-all',
          title: 'Delete',
          onClick: (e) => {
            e.stopPropagation()
            onDelete(card)
          },
        },
        h(Trash2, { size: 15 })
      )
    )
  )
}

function Editor({ card, onClose, onSave }) {
  const isNew = !card.id
  const [title, setTitle] = useState(card.title || '')
  const [description, setDescription] = useState(card.description || '')
  const [priority, setPriority] = useState(card.priority || 'medium')

  const save = () => {
    if (!title.trim()) return
    onSave({ ...card, title: title.trim(), description, priority })
  }

  return h(
    'div',
    {
      className: 'fixed inset-0 z-50 flex items-center justify-center p-4',
      style: { background: 'rgba(0,0,0,0.5)' },
      onClick: onClose,
    },
    h(
      'div',
      {
        className: 'bg-card border border-border rounded-lg shadow-xl w-full max-w-md p-5',
        onClick: (e) => e.stopPropagation(),
      },
      h(
        'div',
        { className: 'flex items-center justify-between mb-4' },
        h('div', { className: 'text-text-strong text-base font-semibold' }, isNew ? 'New card' : 'Edit card'),
        h(
          'button',
          { className: 'p-1 rounded text-muted hover:text-text hover:bg-hover', onClick: onClose },
          h(X, { size: 18 })
        )
      ),
      h('label', { className: 'text-muted text-xs uppercase tracking-wide' }, 'Title'),
      h('input', {
        className:
          'w-full mt-1 mb-3 px-3 py-2 rounded-md border border-border bg-transparent text-text text-sm focus:border-accent outline-none',
        value: title,
        autoFocus: true,
        placeholder: 'What needs doing?',
        onChange: (e) => setTitle(e.target.value),
        onKeyDown: (e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
        },
      }),
      h('label', { className: 'text-muted text-xs uppercase tracking-wide' }, 'Description'),
      h('textarea', {
        className:
          'w-full mt-1 mb-3 px-3 py-2 rounded-md border border-border bg-transparent text-text text-sm focus:border-accent outline-none resize-y min-h-[80px]',
        value: description,
        placeholder: 'Optional details…',
        onChange: (e) => setDescription(e.target.value),
      }),
      h('label', { className: 'text-muted text-xs uppercase tracking-wide' }, 'Priority'),
      h(
        'div',
        { className: 'flex gap-2 mt-1 mb-4' },
        ['low', 'medium', 'high'].map((p) =>
          h(
            'button',
            {
              key: p,
              className:
                'px-3 py-1.5 rounded-md border text-sm capitalize transition-all ' +
                (priority === p
                  ? 'border-accent text-text-strong'
                  : 'border-border text-muted hover:text-text'),
              onClick: () => setPriority(p),
            },
            h(PriorityDot, { priority: p }),
            h('span', { className: 'ml-1.5' }, p)
          )
        )
      ),
      h(
        'div',
        { className: 'flex justify-end gap-2' },
        h(
          'button',
          {
            className: 'px-3 py-1.5 rounded-md border border-border text-muted hover:text-text text-sm',
            onClick: onClose,
          },
          'Cancel'
        ),
        h(
          'button',
          {
            className:
              'px-3 py-1.5 rounded-md bg-accent text-white text-sm font-medium disabled:opacity-50',
            disabled: !title.trim(),
            onClick: save,
          },
          isNew ? 'Create' : 'Save'
        )
      )
    )
  )
}

export default function KanbanApp() {
  const api = useAppApi()
  const [board, setBoard] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editing, setEditing] = useState(null) // card object or {column} for new

  const fetchBoard = useCallback(() => {
    setLoading(true)
    api
      .get('/api/board')
      .then((data) => {
        setBoard(data)
        setError(null)
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false))
  }, [api])

  useEffect(() => {
    fetchBoard()
  }, [fetchBoard])

  const saveCard = (card) => {
    const req = card.id
      ? api.patch(`/api/cards/${card.id}`, {
          title: card.title,
          description: card.description,
          priority: card.priority,
        })
      : api.post('/api/cards', {
          title: card.title,
          description: card.description,
          priority: card.priority,
          column: card.column || 'todo',
        })
    req
      .then(() => {
        setEditing(null)
        fetchBoard()
      })
      .catch((err) => setError(err.message || String(err)))
  }

  const moveCard = (card, column) => {
    api
      .post('/api/cards/move', { id: card.id, column })
      .then(fetchBoard)
      .catch((err) => setError(err.message || String(err)))
  }

  const deleteCard = (card) => {
    api
      .delete(`/api/cards/${card.id}`)
      .then(fetchBoard)
      .catch((err) => setError(err.message || String(err)))
  }

  const total = board ? board.total : 0

  return h(
    'div',
    { className: 'px-6 pt-4 pb-8 flex flex-col h-full min-h-0' },
    // Header
    h(
      'div',
      { className: 'flex items-end justify-between gap-4 pb-3' },
      h(
        'div',
        null,
        h(
          'div',
          { className: 'text-2xl font-bold tracking-tight text-text-strong flex items-center gap-2' },
          h(BoardIcon, { size: 22 }),
          'Kanban'
        ),
        h('div', { className: 'text-muted text-sm mt-1' }, 'Your local task board — no account needed')
      ),
      h(
        'button',
        {
          className:
            'px-2.5 py-1 rounded-md border border-border bg-transparent text-muted hover:text-text hover:border-border-strong text-[13px] cursor-pointer transition-all inline-flex items-center gap-1.5',
          onClick: fetchBoard,
        },
        h(RefreshCw, { size: 14 }),
        'Refresh'
      )
    ),
    // Stats
    h(
      'div',
      { className: 'grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(130px,1fr))] mb-5' },
      h(StatCard, { label: 'Total cards', value: total, accent: true }),
      ...(board
        ? board.columns.map((c) => h(StatCard, { key: c.key, label: c.label, value: c.cards.length }))
        : [])
    ),
    // Error
    error
      ? h(
          'div',
          {
            className:
              'mb-4 px-3 py-2 rounded-md border border-danger/40 text-danger text-sm bg-danger/10',
          },
          error
        )
      : null,
    // Columns
    loading && !board
      ? h('div', { className: 'text-muted text-sm' }, 'Loading…')
      : board
      ? h(
          'div',
          {
            className: 'grid gap-4 flex-1 min-h-0 overflow-y-auto',
            style: { gridTemplateColumns: `repeat(${board.columns.length}, minmax(0, 1fr))` },
          },
          board.columns.map((col, colIndex) =>
            h(
              'div',
              { key: col.key, className: 'flex flex-col min-h-0' },
              h(
                'div',
                { className: 'flex items-center justify-between mb-2 px-1' },
                h(
                  'div',
                  { className: 'text-text-strong text-sm font-semibold flex items-center gap-2' },
                  col.label,
                  h('span', { className: 'text-muted text-xs font-normal' }, `(${col.cards.length})`)
                ),
                h(
                  'button',
                  {
                    className: 'p-1 rounded text-muted hover:text-text hover:bg-hover transition-all',
                    title: `Add card to ${col.label}`,
                    onClick: () => setEditing({ column: col.key, title: '', description: '', priority: 'medium' }),
                  },
                  h(Plus, { size: 16 })
                )
              ),
              h(
                'div',
                {
                  className: 'flex-1 min-h-0 overflow-y-auto rounded-lg p-2',
                  style: { background: 'var(--bg-subtle, rgba(128,128,128,0.06))' },
                },
                col.cards.length === 0
                  ? h('div', { className: 'text-muted text-xs text-center py-6' }, 'No cards')
                  : col.cards.map((card) =>
                      h(CardView, {
                        key: card.id,
                        card,
                        colIndex,
                        onEdit: setEditing,
                        onMove: moveCard,
                        onDelete: deleteCard,
                      })
                    )
              )
            )
          )
        )
      : null,
    // Editor modal
    editing ? h(Editor, { card: editing, onClose: () => setEditing(null), onSave: saveCard }) : null
  )
}
