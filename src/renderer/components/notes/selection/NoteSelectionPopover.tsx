import { Crosshair, Tag as TagIcon, Check } from 'lucide-react'
import { classifySelection, selectionToTagName } from '@shared/selectionKind'
import { RETRO_MAX_CAPTURES } from '@shared/constants'
import {
  SELECTION_POPOVER_WIDTH,
  type SelectionOverlayPosition
} from '@renderer/components/notes/selection/noteSelectionGeometry'
import {
  SELECTION_UI_ATTR,
  type NoteSelectionMode
} from '@renderer/components/notes/selection/useNoteSelection'

interface BarProps extends SelectionOverlayPosition {
  onChoose: (mode: NoteSelectionMode) => void
}

/**
 * Two actions, not three. A Quote action belongs on the extension and capture
 * bars (#393) — in the note editor it would be a note quoting itself.
 */
export function NoteSelectionBar({ x, y, onChoose }: BarProps) {
  return (
    <div
      {...{ [SELECTION_UI_ATTR]: '1' }}
      data-testid="note-selection-bar"
      role="toolbar"
      aria-label="Selection actions"
      style={{ left: x, top: y }}
      className="absolute z-30 flex h-7 items-center overflow-hidden whitespace-nowrap rounded-md border border-border bg-surface shadow-lg"
    >
      <button
        type="button"
        data-testid="note-selection-selector"
        // The editor collapses its selection when a button takes focus, and
        // the selection is what these actions are about.
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChoose('selector')}
        className="flex h-full items-center gap-1.5 px-3 text-xs font-semibold text-accent hover:bg-elevated"
      >
        <Crosshair className="h-3 w-3" />
        Selector
      </button>
      <button
        type="button"
        data-testid="note-selection-tag"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChoose('tag')}
        className="flex h-full items-center gap-1.5 border-l border-border px-3 text-xs font-medium text-text-secondary hover:bg-elevated"
      >
        <TagIcon className="h-3 w-3" />
        Tag
      </button>
    </div>
  )
}

interface CheckboxRowProps {
  checked: boolean
  disabled?: boolean
  label: string
  testId: string
  onToggle?: () => void
}

function CheckboxRow({ checked, disabled = false, label, testId, onToggle }: CheckboxRowProps) {
  return (
    <label
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-xs ${
        disabled ? 'cursor-default text-text-muted' : 'cursor-pointer text-text-secondary'
      }`}
    >
      <span
        aria-hidden
        className={`grid h-3.5 w-3.5 shrink-0 place-items-center rounded border ${
          checked ? 'border-accent bg-accent' : 'border-border-strong bg-transparent'
        }`}
      >
        {checked ? <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.4} /> : null}
      </span>
      <input
        type="checkbox"
        data-testid={testId}
        className="sr-only"
        checked={checked}
        disabled={disabled}
        onChange={() => onToggle?.()}
      />
      {label}
    </label>
  )
}

interface ConfirmProps extends SelectionOverlayPosition {
  text: string
  mode: NoteSelectionMode
  watch: boolean
  pending: boolean
  onToggleWatch: () => void
  onCancel: () => void
  onConfirm: () => void
}

export function NoteSelectionConfirm({
  x,
  y,
  text,
  mode,
  watch,
  pending,
  onToggleWatch,
  onCancel,
  onConfirm
}: ConfirmProps) {
  const { value, kind, note } = classifySelection(text)
  const tagName = selectionToTagName(text)

  return (
    <div
      {...{ [SELECTION_UI_ATTR]: '1' }}
      data-testid="note-selection-confirm"
      role="dialog"
      aria-label={mode === 'selector' ? 'Create selector' : 'Apply tag'}
      style={{ left: x, top: y, width: SELECTION_POPOVER_WIDTH }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onCancel()
        }
      }}
      className="absolute z-40 overflow-hidden rounded-md border border-border bg-surface shadow-lg"
    >
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-3">
        <span
          data-testid="note-selection-kind"
          className="shrink-0 rounded-full border border-accent/30 bg-accent-subtle px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-wide text-accent"
        >
          {kind}
        </span>
        <span
          data-testid="note-selection-value"
          className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary"
        >
          {mode === 'tag' ? tagName : value}
        </span>
      </div>

      {mode === 'selector' && note ? (
        <p className="px-3 pb-1.5 text-[11px] leading-relaxed text-text-muted">{note}</p>
      ) : null}

      {mode === 'selector' ? (
        <>
          <CheckboxRow
            checked={watch}
            label="Watch for new hits"
            testId="note-selection-watch"
            onToggle={onToggleWatch}
          />
          {/* Checked and disabled because it is a statement, not a choice:
              selectorLifecycle backfills every new selector unconditionally,
              and an unticked box would describe behaviour the app does not
              have (#391, ruling R17). The bound is stated rather than implied
              — the backfill stops at RETRO_MAX_CAPTURES, so on a larger case
              an empty match list is not evidence the term is absent from the
              captures below the cut. */}
          <CheckboxRow
            checked
            disabled
            label={`Backfill — always runs, over the ${RETRO_MAX_CAPTURES} most recent captures`}
            testId="note-selection-backfill"
          />
        </>
      ) : (
        <p className="px-3 pb-1.5 text-[11px] leading-relaxed text-text-muted">
          Applies to this note, and to its capture when the note has one. An unsaved note is saved
          first — a tag cannot attach to a note that does not exist.
        </p>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border bg-elevated px-2.5 py-2">
        <button
          type="button"
          data-testid="note-selection-cancel"
          onClick={onCancel}
          className="px-1 text-[11px] text-text-muted hover:text-text-secondary"
        >
          Esc to cancel
        </button>
        <button
          type="button"
          data-testid="note-selection-confirm-submit"
          autoFocus
          disabled={pending}
          onClick={onConfirm}
          className="flex h-6 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-white disabled:opacity-60"
        >
          {mode === 'selector' ? 'Create' : 'Apply'}
        </button>
      </div>
    </div>
  )
}
