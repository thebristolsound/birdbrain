import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Minus, Plus } from 'lucide-react'
import { DEFAULT_TAG_COLOR, TAG_COLOR_PRESETS } from '@renderer/components/tags/tagColors'
import { notify } from '@renderer/lib/notify'
import {
  useBatchTagEditor,
  type BatchTagState
} from '@renderer/components/captures/useBatchTagEditor'

interface BatchTagPopoverProps {
  caseId: string
  // The visible selection, in display order. The bar's other actions are
  // scoped the same way.
  selectedIds: string[]
  onClose: () => void
  anchorRef: React.RefObject<HTMLElement | null>
}

const CHECKBOX_BASE =
  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] border transition-colors'

function checkboxClass(state: BatchTagState): string {
  if (state === 'all') return `${CHECKBOX_BASE} border-accent bg-accent`
  if (state === 'partial') return `${CHECKBOX_BASE} border-accent bg-transparent`
  return `${CHECKBOX_BASE} border-border-strong bg-transparent`
}

function ariaChecked(state: BatchTagState): boolean | 'mixed' {
  if (state === 'all') return true
  if (state === 'partial') return 'mixed'
  return false
}

/**
 * The batch-tag picker the selection bar's Tag action opens (#665), replacing
 * the interim apply-one-and-close list #396 shipped. Four differences, one per
 * gap that ticket filed:
 *
 * - the input creates as well as filters, so an empty case is not a dead end;
 * - it stays open across writes, so three tags is one gesture;
 * - every row shows none / partial / all with the fraction, so re-applying a
 *   tag some rows already carry no longer looks like applying a new one;
 * - a fully applied tag can be removed from the selection.
 *
 * Applying does not toast. The row filling in says more than a toast can, and
 * one per click would make multi-apply, the thing being added, unusable.
 * Removing does toast, because none of that holds for it: the row only empties,
 * there is no undo, and `capture_tags` keeps no history, so a removal the
 * operator did not mean would otherwise leave no trace at all. Failures toast
 * either way, through the mutation cache.
 */
export function BatchTagPopover({ caseId, selectedIds, onClose, anchorRef }: BatchTagPopoverProps) {
  const { rows, total, isLoading, toggleTag, applyTag, createAndApply, isWriting } =
    useBatchTagEditor(caseId, selectedIds)
  const [query, setQuery] = useState('')
  const [color, setColor] = useState(DEFAULT_TAG_COLOR)
  const [showColors, setShowColors] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node
      if (popoverRef.current?.contains(target)) return
      // The button that opened it owns that path; closing here too would make
      // a second click reopen rather than dismiss.
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose, anchorRef])

  const trimmed = query.trim()
  const visible = useMemo(() => {
    const needle = trimmed.toLowerCase()
    return needle ? rows.filter((r) => r.tag.name.toLowerCase().includes(needle)) : rows
  }, [rows, trimmed])

  // Case-insensitive, matching what main does when it resolves the name: an
  // input of "Evidence" against an existing "evidence" offers to apply that
  // tag rather than to create a second one it would never get.
  const exactMatch = rows.find((r) => r.tag.name.toLowerCase() === trimmed.toLowerCase())
  const canCreate = trimmed.length > 0 && !exactMatch

  async function handleToggle(tagId: string) {
    // Read off the pre-write rows: the refetch the mutation triggers can land
    // before the toast is composed, and a removed tag may no longer be there.
    const name = rows.find((r) => r.tag.id === tagId)?.tag.name ?? 'tag'
    try {
      if ((await toggleTag(tagId)) === 'removed') {
        notify.success(`Removed ${name} from ${total} capture${total === 1 ? '' : 's'}`)
      }
    } catch {
      // The mutation cache toasts it; the row reverts on the refetch.
    }
  }

  async function handleApply(tagId: string) {
    try {
      await applyTag(tagId)
    } catch {
      // As above.
    }
  }

  async function handleCreate() {
    if (!canCreate) return
    try {
      await createAndApply(trimmed, color)
      setQuery('')
    } catch {
      // As above — the name is kept so the operator can retry or edit it.
    }
  }

  return (
    <div
      ref={popoverRef}
      // Keeps the capture list's Escape handler from clearing the selection
      // out from under an open picker.
      data-selection-escape-guard=""
      data-testid="batch-tag-popover"
      className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-border-strong bg-card shadow-xl"
    >
      <div className="border-b border-border px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-text-faint">
        Tag {total} capture{total === 1 ? '' : 's'}
      </div>

      <div className="flex items-center gap-1.5 border-b border-border px-3 py-2">
        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setShowColors(!showColors)}
            className="flex h-4 w-4 items-center justify-center rounded-full ring-1 ring-border transition-transform hover:scale-110"
            style={{ backgroundColor: color }}
            title="Pick color"
          />
          {showColors && (
            <div className="absolute top-full left-0 z-10 mt-1 flex flex-col gap-1 rounded-lg border border-border-strong bg-card p-1.5 shadow-lg">
              {TAG_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Use color ${c}`}
                  onClick={() => {
                    setColor(c)
                    setShowColors(false)
                  }}
                  className="h-4 w-4 rounded-full ring-1 ring-border hover:scale-110"
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          )}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            // Enter only ever applies. The input is also the filter, so typing
            // a name out in full is how the list is narrowed to it; if that
            // gesture toggled, an operator narrowing to a tag the selection
            // already carries would strip it from every capture instead — a
            // write with no confirm, no undo and no audit trail. Removal stays
            // on the row click, which warns in its tooltip.
            if (exactMatch) handleApply(exactMatch.tag.id)
            else handleCreate()
          }}
          placeholder="Find or create a tag"
          aria-label="Find or create a tag"
          className="min-w-0 flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-faint focus:outline-none"
        />
      </div>

      <div
        role="menu"
        aria-label="Tags"
        aria-busy={isLoading}
        className="max-h-48 overflow-y-auto py-1"
      >
        {/*
          No rows until the membership read lands. Until then every count is 0,
          which renders `none` — so a tag on all of the selection would show an
          empty checkbox and an aria-checked of false, and a click in that
          window applies what the operator meant to remove.
        */}
        {isLoading && <div className="px-3 py-2 text-[11px] text-text-faint">Loading tags…</div>}
        {!isLoading && visible.length === 0 && (
          <div className="px-3 py-2 text-[11px] text-text-faint">
            {rows.length === 0 ? 'No tags yet — type a name to create one.' : 'No tag matches.'}
          </div>
        )}
        {!isLoading &&
          visible.map(({ tag, count, state }) => (
            <button
              key={tag.id}
              role="menuitemcheckbox"
              aria-checked={ariaChecked(state)}
              disabled={isWriting}
              onClick={() => handleToggle(tag.id)}
              title={state === 'all' ? `Remove ${tag.name} from the selection` : undefined}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-secondary hover:bg-elevated disabled:opacity-60"
            >
              <span aria-hidden="true" className={checkboxClass(state)}>
                {state === 'all' && <Check className="h-2.5 w-2.5 text-white" strokeWidth={3} />}
                {state === 'partial' && (
                  <Minus className="h-2.5 w-2.5 text-accent" strokeWidth={3} />
                )}
              </span>
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tag.color || DEFAULT_TAG_COLOR }}
              />
              <span className="min-w-0 flex-1 truncate">{tag.name}</span>
              {state === 'partial' && (
                <span className="shrink-0 text-[10px] tabular-nums text-text-faint">
                  {count}/{total}
                </span>
              )}
            </button>
          ))}
      </div>

      {canCreate && (
        <div className="border-t border-border p-1">
          <button
            type="button"
            onClick={handleCreate}
            disabled={isWriting}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-accent hover:bg-accent-subtle disabled:opacity-60"
          >
            <Plus className="h-3 w-3 shrink-0" strokeWidth={2.2} />
            <span className="min-w-0 truncate">Create &ldquo;{trimmed}&rdquo; and apply</span>
          </button>
        </div>
      )}
    </div>
  )
}
