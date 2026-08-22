import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useNotesMutations } from '@renderer/lib/queries'
import { NoteEditor } from '@renderer/components/notes/NoteEditor'
import { useNoteEditor } from '@renderer/components/notes/useNoteEditor'
import { EMPTY_NOTE_DOC, plainTextToNoteDoc } from '@shared/noteDoc'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input
} from '@renderer/components/ui'

interface AddNoteModalProps {
  open: boolean
  caseId: string
  captureId: string
  captureTitle: string
  captureUrl: string
  onClose: () => void
  prefillTitle?: string
  prefillBody?: string
}

export function AddNoteModal({
  open,
  caseId,
  captureId,
  captureTitle,
  captureUrl,
  onClose,
  prefillTitle,
  prefillBody
}: AddNoteModalProps) {
  const { create } = useNotesMutations(caseId)
  const [title, setTitle] = useState('')
  const [bodyDoc, setBodyDoc] = useState<string | null>(null)
  const editor = useNoteEditor({ caseId, onChange: setBodyDoc, testId: 'add-note-body' })
  const hasBody = editor ? !editor.isEmpty : false

  useEffect(() => {
    if (!open || !editor) return
    setTitle(prefillTitle ?? captureTitle)
    // Prefilled text (a selected passage, say) arrives as plain text; lift it
    // into document form so the investigator can format from there.
    const doc = prefillBody ? plainTextToNoteDoc(prefillBody) : EMPTY_NOTE_DOC
    editor.commands.setContent(doc)
    setBodyDoc(JSON.stringify(doc))
  }, [open, editor, captureTitle, prefillTitle, prefillBody])

  async function handleSave() {
    if (!title.trim() && !hasBody) return
    await create.mutateAsync({
      caseId,
      captureId,
      title: title.trim(),
      bodyDoc: bodyDoc ?? JSON.stringify(EMPTY_NOTE_DOC),
      sourceUrl: captureUrl
    })
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent onClose={onClose} data-testid="add-note-modal">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="font-display text-sm">Add note</DialogTitle>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </DialogHeader>
        <Input
          data-testid="add-note-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          className="mb-2 border-border bg-canvas font-semibold"
        />
        <div className="mb-3">
          <NoteEditor
            editor={editor}
            minHeightClass="min-h-32"
            placeholder="Start writing — type @ to link a capture, # for a selector or tag."
          />
        </div>
        <div className="mb-3 truncate text-[11px] text-text-muted">Linked to: {captureUrl}</div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="add-note-submit"
            size="sm"
            onClick={handleSave}
            disabled={(!title.trim() && !hasBody) || create.isPending}
          >
            {create.isPending ? 'Saving...' : 'Save note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
