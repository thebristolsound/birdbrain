import { useEffect, useState, type CSSProperties } from 'react'
import { Trash2 } from 'lucide-react'

interface Props {
  open: boolean
  // A pin dropped in this sitting and not yet given its note. Cancel discards
  // it; a saved pin opens on its note instead, with a delete control.
  isDraft: boolean
  initialBody: string
  meta: string
  // Where the popover sits over the canvas, already resolved to the pin's
  // on-screen position by the editor.
  style?: CSSProperties
  saving?: boolean
  onSave: (body: string) => void
  onCancelDraft: () => void
  onDelete: () => void
  onClose: () => void
}

const PLACEHOLDER = 'What does this pin mark?'

export function PinCommentPopover({
  open,
  isDraft,
  initialBody,
  meta,
  style,
  saving,
  onSave,
  onCancelDraft,
  onDelete,
  onClose
}: Props) {
  const [body, setBody] = useState(initialBody)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    // Only reset on open transition; intentionally omit initialBody from deps
    // to avoid clobbering user input when bundle refetches after a save
    if (open) {
      setBody(initialBody)
      setEditing(false)
    }
  }, [open])

  if (!open) return null

  const composing = isDraft || editing
  const cancel = () => {
    if (isDraft) onCancelDraft()
    else setEditing(false)
  }

  return (
    <div
      role="dialog"
      aria-label={meta}
      data-testid="pin-popover"
      style={style}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.stopPropagation()
        if (isDraft) onCancelDraft()
        else onClose()
      }}
      className="absolute z-[25] w-56 cursor-default rounded-md border border-border-strong bg-card p-2.5 text-left shadow-xl"
    >
      {composing ? (
        <>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            autoFocus
            placeholder={PLACEHOLDER}
            className="w-full resize-none rounded border border-border-strong bg-canvas px-2 py-1.5 text-[11px] leading-normal text-text-primary outline-none"
          />
          <div className="mt-2 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={cancel}
              className="h-6 rounded px-2 text-[11px] text-text-muted hover:bg-elevated"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => onSave(body)}
              disabled={saving}
              className="h-6 rounded bg-accent px-2.5 font-display text-[11px] font-semibold text-white hover:bg-accent-hover disabled:opacity-40"
            >
              {isDraft ? 'Add pin' : 'Save'}
            </button>
          </div>
        </>
      ) : (
        <>
          {/* The design shows the note read-only; clicking it is how a pin's
              note is still corrected after it is saved. */}
          <button
            type="button"
            onClick={() => setEditing(true)}
            title="Edit note"
            className="block w-full whitespace-pre-wrap break-words text-left text-[11px] leading-[1.55] text-text-primary"
          >
            {initialBody || <span className="italic text-text-faint">No note</span>}
          </button>
          <div className="mt-2 flex items-center gap-1.5">
            <span className="text-[10px] text-text-faint">{meta}</span>
            <span className="flex-1" />
            <button
              type="button"
              onClick={onDelete}
              title="Delete pin"
              aria-label="Delete pin"
              className="grid h-[22px] w-[22px] place-items-center rounded text-red-400 hover:bg-elevated"
            >
              <Trash2 className="h-3 w-3" strokeWidth={1.9} />
            </button>
          </div>
        </>
      )}
    </div>
  )
}
