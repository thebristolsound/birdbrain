import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useNotesMutations } from '@renderer/lib/queries'

interface AddNoteModalProps {
  open: boolean
  caseId: string
  captureId: string
  captureTitle: string
  captureUrl: string
  onClose: () => void
}

export function AddNoteModal({
  open,
  caseId,
  captureId,
  captureTitle,
  captureUrl,
  onClose
}: AddNoteModalProps) {
  const { create } = useNotesMutations(caseId)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  useEffect(() => {
    if (open) {
      setTitle(captureTitle)
      setBody('')
    }
  }, [open, captureTitle])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  async function handleSave() {
    if (!title.trim() && !body.trim()) return
    await create.mutateAsync({
      caseId,
      captureId,
      title: title.trim(),
      body: body.trim(),
      sourceUrl: captureUrl
    })
    onClose()
  }

  return (
    <div
      data-testid="add-note-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl border border-border bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-sm font-semibold text-text-primary">Add note</h3>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <input
          data-testid="add-note-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mb-2 w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm font-semibold text-text-primary"
        />
        <textarea
          data-testid="add-note-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What did you observe?"
          rows={5}
          autoFocus
          className="mb-3 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text-secondary"
        />
        <div className="mb-3 truncate text-[11px] text-text-muted">Linked to: {captureUrl}</div>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3 py-1.5 text-xs text-text-muted hover:bg-elevated"
          >
            Cancel
          </button>
          <button
            data-testid="add-note-submit"
            onClick={handleSave}
            disabled={(!title.trim() && !body.trim()) || create.isPending}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas hover:opacity-90 disabled:opacity-50"
          >
            {create.isPending ? 'Saving...' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  )
}
