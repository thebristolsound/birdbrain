import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { Capture } from '@shared/types'
import { CoverageStrip } from '@renderer/components/signals/CoverageStrip'
import type { Signal } from '@renderer/components/signals/signalsModel'

interface SignalRowProps {
  signal: Signal
  captures: Capture[]
  selected: boolean
  onSelect: () => void
  onToggleEnabled: () => void
  onToggleRegex: () => void
  onRename: (value: string) => void
  onDelete: () => void
  /** Move focus to the row above/below, or out of the list at the top. */
  onFocusSibling: (direction: -1 | 1) => void
  registerRow: (element: HTMLDivElement | null) => void
}

// One row on either card. Selectors and Tags share it because they are the same
// object to the operator — a thing this case is watching for — and differ only
// in what can be switched.
//
// No onContextMenu: right-click menus are #701 and the maintainer ruled that
// wave 2 leaves no hooks for them, so there is no placeholder prop here either.
export function SignalRow({
  signal,
  captures,
  selected,
  onSelect,
  onToggleEnabled,
  onToggleRegex,
  onRename,
  onDelete,
  onFocusSibling,
  registerRow
}: SignalRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isSelector = signal.kind === 'selector'

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  function beginEdit() {
    setDraft(isSelector ? signal.sub : signal.name)
    setEditing(true)
    onSelect()
  }

  function commit() {
    setEditing(false)
    const value = draft.trim()
    if (value) onRename(value)
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (editing) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      onFocusSibling(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      onFocusSibling(-1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      beginEdit()
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault()
      onDelete()
    } else if (event.key === ' ') {
      event.preventDefault()
      // Selectors only: a tag has nothing to switch, and swallowing the key
      // for it would make the legend a lie on half the rows.
      if (isSelector) onToggleEnabled()
    }
  }

  return (
    <div
      ref={registerRow}
      role="button"
      tabIndex={0}
      data-testid={`signal-row-${signal.id}`}
      data-selected={selected ? 'true' : 'false'}
      onClick={onSelect}
      onDoubleClick={beginEdit}
      onKeyDown={handleKey}
      className={[
        'group flex cursor-pointer items-center gap-3 rounded px-[10px] py-2 transition-colors',
        'outline-none focus:border-accent focus:bg-accent-subtle',
        selected ? 'border border-accent/35 bg-accent-subtle' : 'border border-transparent'
      ].join(' ')}
    >
      {isSelector ? (
        <button
          type="button"
          role="switch"
          aria-checked={signal.enabled}
          aria-label={`Enable ${signal.name}`}
          onClick={(event) => {
            event.stopPropagation()
            onToggleEnabled()
          }}
          className={[
            'relative inline-flex h-4 w-[30px] shrink-0 items-center rounded-full transition-colors',
            signal.enabled ? 'bg-accent' : 'bg-text-faint'
          ].join(' ')}
        >
          <span
            className={[
              'inline-block h-3 w-3 rounded-full bg-white transition-transform',
              signal.enabled ? 'translate-x-[16px]' : 'translate-x-[2px]'
            ].join(' ')}
          />
        </button>
      ) : (
        <span className="flex w-[30px] shrink-0 justify-center">
          <span
            className="h-[9px] w-[9px] rounded-full"
            style={{ background: signal.color }}
            data-testid="signal-color-dot"
          />
        </span>
      )}

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          aria-label={isSelector ? 'Edit selector pattern' : 'Edit tag name'}
          onChange={(event) => setDraft(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={commit}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === 'Escape') setEditing(false)
            if (event.key === 'Enter') commit()
          }}
          className="min-w-0 flex-1 rounded border border-accent bg-canvas px-2 py-1 font-mono text-xs text-text-primary outline-none"
        />
      ) : (
        <div
          className={`min-w-0 flex-1 ${isSelector && !signal.enabled ? 'opacity-40' : ''}`}
          data-testid="signal-name-block"
        >
          <div className="truncate text-xs font-semibold text-text-primary">{signal.name}</div>
          {signal.sub && (
            <div className="mt-px truncate font-mono text-[10px] text-text-faint">{signal.sub}</div>
          )}
        </div>
      )}

      {isSelector && (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggleRegex()
          }}
          title={
            signal.isRegex ? 'Regex pattern — click for exact text' : 'Exact text — click for regex'
          }
          className={[
            'shrink-0 rounded px-1.5 py-px font-mono text-[10px] font-semibold leading-4',
            signal.isRegex
              ? 'border border-accent/30 bg-accent-subtle text-accent'
              : 'border border-border text-text-faint'
          ].join(' ')}
        >
          {signal.isRegex ? '.*' : 'Aa'}
        </button>
      )}

      <CoverageStrip
        captures={captures}
        captureIds={signal.captureIds}
        fill={
          signal.kind === 'tag' ? (signal.color ?? 'var(--color-accent)') : 'var(--color-accent)'
        }
        label={signal.name}
      />

      <span
        data-testid="signal-count"
        className={`w-7 shrink-0 text-right text-xs tabular-nums ${
          isSelector ? 'text-accent' : 'text-text-muted'
        }`}
      >
        {signal.count}
      </span>

      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onDelete()
        }}
        title={isSelector ? 'Delete selector' : 'Delete tag'}
        aria-label={`Delete ${signal.name}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-faint opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-400 focus:opacity-100 group-hover:opacity-100"
      >
        <X className="h-3 w-3" strokeWidth={2} />
      </button>
    </div>
  )
}
