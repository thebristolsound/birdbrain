import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useNotesMutations } from '@renderer/lib/queries'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  Button,
  Input,
  Textarea
} from '@renderer/components/ui'

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
        <Textarea
          data-testid="add-note-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What did you observe?"
          rows={5}
          autoFocus
          className="mb-3 border-border bg-canvas text-text-secondary"
        />
        <div className="mb-3 truncate text-[11px] text-text-muted">Linked to: {captureUrl}</div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="add-note-submit"
            size="sm"
            onClick={handleSave}
            disabled={(!title.trim() && !body.trim()) || create.isPending}
          >
            {create.isPending ? 'Saving...' : 'Save note'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
