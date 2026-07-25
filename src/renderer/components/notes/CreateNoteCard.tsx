import { useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useNotesMutations } from '@renderer/lib/queries'
import { Button, Input } from '@renderer/components/ui'
import { NoteEditor } from '@renderer/components/notes/NoteEditor'
import { useNoteEditor } from '@renderer/components/notes/useNoteEditor'
import { EMPTY_NOTE_DOC } from '@shared/noteDoc'

interface CreateNoteCardProps {
  caseId: string
  isOpen: boolean
  onToggle: () => void
  onCreated?: () => void
}

export function CreateNoteCard({ caseId, isOpen, onToggle, onCreated }: CreateNoteCardProps) {
  const { create } = useNotesMutations(caseId)
  const [title, setTitle] = useState('')
  const [bodyDoc, setBodyDoc] = useState<string | null>(null)
  const editor = useNoteEditor({ onChange: setBodyDoc, testId: 'create-note-body' })
  const hasBody = editor ? !editor.isEmpty : false

  async function handleSubmit() {
    if (!title.trim() && !hasBody) return
    await create.mutateAsync({
      caseId,
      title: title.trim(),
      bodyDoc: bodyDoc ?? JSON.stringify(EMPTY_NOTE_DOC)
    })
    setTitle('')
    setBodyDoc(null)
    editor?.commands.clearContent()
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
        <Button variant="ghost" size="icon-sm" onClick={onToggle}>
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      <Input
        data-testid="create-note-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title (optional)"
        className="mb-2 border-border bg-canvas font-semibold"
      />
      <div className="mb-3">
        <NoteEditor editor={editor} placeholder="Note body" />
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onToggle}>
          Cancel
        </Button>
        <Button
          data-testid="create-note-submit"
          size="sm"
          onClick={handleSubmit}
          disabled={(!title.trim() && !hasBody) || create.isPending}
        >
          {create.isPending ? 'Saving...' : 'Save note'}
        </Button>
      </div>
    </div>
  )
}
