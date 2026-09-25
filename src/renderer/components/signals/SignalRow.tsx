import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { X } from 'lucide-react'
import type { Capture } from '@shared/types'
import { CoverageStrip } from '@renderer/components/signals/CoverageStrip'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import type { EntityMenuTarget } from '@renderer/components/contextmenu/entityMenu'
import { TAG_PALETTE_LABELS, type Signal } from '@renderer/components/signals/signalsModel'

interface SignalRowProps {
  signal: Signal
  captures: Capture[]
  selected: boolean
  onSelect: () => void
  onToggleEnabled: () => void
  onToggleRegex: () => void
  onRename: (value: string) => void
  onDelete: () => void
  /** Selectors only: filter the captures list by this selector and go there. */
  onShowMatches: () => void
  /** Selectors only: start a new selector from this one's pattern. */
  onDuplicate: () => void
  /** Selectors only: put the pattern on the clipboard. */
  onCopyPattern: () => void
  /** Selectors only: write this selector's matches out as CSV. */
  onExportMatches: () => void
  /** Tags only: narrow the captures list by this tag and go there (#918). */
  onFilterCaptures: () => void
  onDuplicateTag: () => void
  onExportTag: () => void
  onCopyTagMarkdown: () => void
  /** Tags only: recolour the tag from the shared palette. */
  onSetColor: (color: string) => void
  /** Tags only: open the merge dialog with this tag as the source. */
  onMerge: () => void
  /** Move focus to the row above/below, or out of the list at the top. */
  onFocusSibling: (direction: -1 | 1) => void
  registerRow: (element: HTMLDivElement | null) => void
}

// Cmd on macOS, Ctrl elsewhere, with no other modifier: the copy chord the
// menu's Copy pattern item names. Text the operator has selected is what they
// meant to copy, so a live selection falls through to the browser.
function isCopyChord(event: KeyboardEvent<HTMLDivElement>): boolean {
  if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return false
  if (event.key !== 'c' && event.key !== 'C') return false
  const selection = window.getSelection()
  return !selection || selection.isCollapsed
}

// One row on either card. Selectors and Tags share it because they are the same
// object to the operator — a thing this case is watching for — and differ only
// in what can be switched.
//
// Wave 2 deliberately left no context-menu hooks here; #701 added them in wave
// 3 against the final layout. The row is its own adoption point because it owns
// the rename edit state its menu opens; everything the menu cannot reach from
// here arrives as a prop.
export function SignalRow({
  signal,
  captures,
  selected,
  onSelect,
  onToggleEnabled,
  onToggleRegex,
  onRename,
  onDelete,
  onShowMatches,
  onDuplicate,
  onCopyPattern,
  onExportMatches,
  onFilterCaptures,
  onDuplicateTag,
  onExportTag,
  onCopyTagMarkdown,
  onSetColor,
  onMerge,
  onFocusSibling,
  registerRow
}: SignalRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const rowRef = useRef<HTMLDivElement | null>(null)
  // Set when Enter or Escape ends the edit, and read once the input is gone:
  // focusing the row while the input is still mounted would blur it into a
  // second commit.
  const refocusRowRef = useRef(false)
  const isSelector = signal.kind === 'selector'

  const original = isSelector ? signal.sub : signal.name

  // Caret at the end rather than the whole value selected (#1549): with the
  // pattern pre-selected, the first keystroke replaced it, and a changed
  // pattern clears and re-runs every persisted match.
  useEffect(() => {
    if (editing) {
      const input = inputRef.current
      if (!input) return
      input.focus()
      input.setSelectionRange(input.value.length, input.value.length)
      return
    }
    // The input unmounts under the keyboard's focus, which would drop it to the
    // top of the document. A blur commit is left alone: focus already went
    // where the operator sent it.
    if (refocusRowRef.current) {
      refocusRowRef.current = false
      rowRef.current?.focus()
    }
  }, [editing])

  function beginEdit() {
    setDraft(original)
    setEditing(true)
    onSelect()
  }

  // An unchanged value writes nothing, so leaving the editor by blur is never
  // an edit.
  function commit() {
    setEditing(false)
    const value = draft.trim()
    if (value && value !== original) onRename(value)
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (editing) return
    if (isSelector && isCopyChord(event)) {
      event.preventDefault()
      onCopyPattern()
    } else if (event.key === 'ArrowDown') {
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

  // Right-clicking a row does not select it, matching the design: the menu
  // states its own target in its header, and stealing the selection would move
  // the detail rail off whatever the operator was reading.
  const menuTarget: EntityMenuTarget = isSelector
    ? {
        kind: 'selector',
        selectorId: signal.id,
        label: signal.name,
        enabled: signal.enabled,
        matchCount: signal.count,
        actions: {
          editPattern: beginEdit,
          toggleEnabled: onToggleEnabled,
          duplicate: onDuplicate,
          showMatches: onShowMatches,
          copyPattern: onCopyPattern,
          exportMatches: onExportMatches,
          remove: onDelete
        }
      }
    : {
        kind: 'tag',
        tagId: signal.id,
        name: signal.name,
        color: signal.color ?? null,
        palette: TAG_PALETTE_LABELS,
        actions: {
          filterCaptures: onFilterCaptures,
          duplicate: onDuplicateTag,
          exportCaptures: onExportTag,
          copyMarkdown: onCopyTagMarkdown,
          rename: beginEdit,
          setColor: onSetColor,
          merge: onMerge,
          remove: onDelete
        }
      }

  return (
    <EntityContextMenu target={menuTarget}>
      <div
        ref={(element) => {
          rowRef.current = element
          registerRow(element)
        }}
        role="button"
        tabIndex={0}
        data-testid={`signal-row-${signal.id}`}
        data-selected={selected ? 'true' : 'false'}
        onClick={onSelect}
        onDoubleClick={beginEdit}
        onKeyDown={handleKey}
        className={[
          'signal-enter group flex cursor-pointer items-center gap-3 rounded px-[10px] py-2 transition-colors',
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
              if (event.key === 'Escape') {
                refocusRowRef.current = true
                setEditing(false)
              }
              if (event.key === 'Enter') {
                refocusRowRef.current = true
                commit()
              }
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
              <div className="mt-px truncate font-mono text-[10px] text-text-faint">
                {signal.sub}
              </div>
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
              signal.isRegex
                ? 'Regex pattern — click for exact text'
                : 'Exact text — click for regex'
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
    </EntityContextMenu>
  )
}
