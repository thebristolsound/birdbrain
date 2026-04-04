import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useNotesMutations } from '@renderer/lib/queries'

interface CreateNoteCardProps {
  caseId: string
  isOpen: boolean
  onToggle: () => void
  onCreated?: () => void
}

export function CreateNoteCard({ caseId, isOpen, onToggle, onCreated }: CreateNoteCardProps) {
  const { create } = useNotesMutations(caseId)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  async function handleSubmit() {
    if (!title.trim() && !body.trim()) return
    await create.mutateAsync({
      caseId,
      title: title.trim(),
      body: body.trim()
    })
    setTitle('')
    setBody('')
    onCreated?.()
  }

  if (!isOpen) {
    return (
      <button
        data-testid="notes-new-button"
        onClick={onToggle}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-surface px-4 py-3 text-sm font-medium text-text-muted hover:border-accent hover:text-accent"
      >
        <Plus className="h-4 w-4" />
        New note
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-display text-sm font-semibold text-text-primary">New note</h3>
        <button
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-text-muted hover:bg-elevated hover:text-text-primary"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        data-testid="create-note-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="mb-2 w-full rounded-lg border border-border bg-canvas px-3 py-1.5 text-sm font-semibold text-text-primary"
      />
      <textarea
        data-testid="create-note-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Note body"
        rows={4}
        className="mb-3 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm text-text-secondary"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onToggle}
          className="rounded-lg px-3 py-1.5 text-xs text-text-muted hover:bg-elevated"
        >
          Cancel
        </button>
        <button
          data-testid="create-note-submit"
          onClick={handleSubmit}
          disabled={(!title.trim() && !body.trim()) || create.isPending}
          className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-canvas hover:opacity-90 disabled:opacity-50"
        >
          {create.isPending ? 'Saving...' : 'Save note'}
        </button>
      </div>
    </div>
  )
}
