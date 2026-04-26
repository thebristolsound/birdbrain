import { useEffect, useState } from 'react'

interface Props {
  open: boolean
  pinNumber: number | null
  initialBody: string
  saving?: boolean
  onSave: (body: string) => void
  onClose: () => void
}

export function PinCommentPopover({
  open,
  pinNumber,
  initialBody,
  saving,
  onSave,
  onClose
}: Props) {
  const [body, setBody] = useState(initialBody)

  useEffect(() => {
    // Only reset on open transition; intentionally omit initialBody from deps
    // to avoid clobbering user input when bundle refetches after a save
    if (open) setBody(initialBody)
  }, [open])

  if (!open) return null

  return (
    <div className="absolute right-2 top-2 z-10 w-72 rounded border border-border bg-surface p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-primary">
          Pin {pinNumber == null ? '(saving…)' : pinNumber}
        </h4>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close pin comment"
          className="text-text-muted hover:text-text-primary"
        >
          ×
        </button>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={4}
        className="w-full rounded border border-border bg-canvas p-2 text-sm text-text-primary"
        placeholder="What did you find?"
      />
      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3 py-1 text-sm text-text-muted hover:bg-canvas"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onSave(body)}
          disabled={saving}
          className="rounded bg-accent px-3 py-1 text-sm text-white hover:bg-accent/80 disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
