import { useState } from 'react'
import { StickyNote, Pencil, Trash2, ExternalLink, X, Check } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { captureThumbnailQueryOptions, useNotesMutations } from '@renderer/lib/queries'
import { openCaptureExternal } from '@renderer/lib/api/system'
import { notify } from '@renderer/lib/notify'
import type { Note } from '@shared/types'
import { Button, Input } from '@renderer/components/ui'
import { NoteBody } from '@renderer/components/notes/NoteBody'
import { NoteEditor } from '@renderer/components/notes/NoteEditor'
import { useNoteEditor } from '@renderer/components/notes/useNoteEditor'

function formatRelative(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  return new Date(ts).toLocaleString()
}

interface NoteCardProps {
  note: Note
  caseId: string
  /** Marks the note the operator arrived here to read (#403 activity feed). */
  selected?: boolean
}

interface NoteCardEditorProps {
  note: Note
  isPending: boolean
  onSave: (values: { title: string; bodyDoc: string }) => void
  onCancel: () => void
}

/**
 * Mounted only while editing. Keeping the editor out of the read-only card
 * means a case with two hundred notes does not mount two hundred ProseMirror
 * views to display them.
 */
function NoteCardEditor({ note, isPending, onSave, onCancel }: NoteCardEditorProps) {
  const [title, setTitle] = useState(note.title)
  const [bodyDoc, setBodyDoc] = useState<string | null>(note.bodyDoc ?? null)
  const editor = useNoteEditor({
    bodyDoc: note.bodyDoc,
    plainText: note.body,
    onChange: setBodyDoc,
    testId: 'note-body-input'
  })

  function handleSubmit() {
    // A legacy note the user opened but did not retype still has no bodyDoc in
    // state; serialize what the editor lifted its plain text into.
    const doc = bodyDoc ?? (editor ? JSON.stringify(editor.getJSON()) : null)
    if (doc === null) return
    onSave({ title, bodyDoc: doc })
  }

  return (
    <div className="space-y-2">
      <Input
        data-testid="note-title-input"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        className="border-border bg-canvas font-semibold"
      />
      <NoteEditor editor={editor} placeholder="Note body" />
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" size="xs" onClick={onCancel} className="gap-1" type="button">
          <X className="h-3.5 w-3.5" />
          Cancel
        </Button>
        <Button
          data-testid="note-save"
          size="xs"
          type="button"
          onClick={handleSubmit}
          disabled={isPending}
          className="gap-1"
        >
          <Check className="h-3.5 w-3.5" />
          Save
        </Button>
      </div>
    </div>
  )
}

export function NoteCard({ note, caseId, selected = false }: NoteCardProps) {
  const { update, remove } = useNotesMutations(caseId)
  const [isEditing, setIsEditing] = useState(false)
  const { data: thumbnail } = useQuery({
    ...captureThumbnailQueryOptions(note.captureId || ''),
    enabled: !!note.captureId
  })
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function handleSave(values: { title: string; bodyDoc: string }) {
    await update.mutateAsync({ id: note.id, ...values })
    setIsEditing(false)
  }

  function handleCancel() {
    setIsEditing(false)
  }

  async function handleDelete() {
    await remove.mutateAsync(note.id)
  }

  async function handleOpenUrl() {
    if (!note.sourceUrl) return
    try {
      await openCaptureExternal(note.sourceUrl)
    } catch (cause) {
      notify.error("Couldn't open the link in your browser", { cause })
    }
  }

  const displayTitle = note.title || '(Untitled note)'
  const thumbSrc = thumbnail ? `data:image/jpeg;base64,${thumbnail}` : null

  return (
    <div
      key={note.id}
      data-testid={`note-card-${note.id}`}
      aria-current={selected ? 'true' : undefined}
      className={`flex gap-3 rounded-2xl border bg-surface p-4 ${
        selected ? 'border-accent/60 ring-1 ring-accent/30' : 'border-border'
      }`}
    >
      <div className="shrink-0">
        {thumbSrc ? (
          <img
            src={thumbSrc}
            alt=""
            className="h-20 w-28 rounded-lg border border-border object-cover"
          />
        ) : (
          <div className="flex h-20 w-28 items-center justify-center rounded-lg border border-border bg-elevated text-text-muted">
            <StickyNote className="h-5 w-5" />
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        {isEditing ? (
          <NoteCardEditor
            key={`edit-${note.id}`}
            note={note}
            isPending={update.isPending}
            onSave={handleSave}
            onCancel={handleCancel}
          />
        ) : (
          <>
            <div className="flex items-start gap-2">
              <h3 className="flex-1 truncate font-display text-sm font-semibold text-text-primary">
                {displayTitle}
              </h3>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  data-testid="note-edit"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setIsEditing(true)}
                  title="Edit note"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {confirmDelete ? (
                  <>
                    <Button
                      data-testid="note-confirm-delete"
                      variant="destructive"
                      size="xs"
                      onClick={handleDelete}
                    >
                      Confirm
                    </Button>
                    <Button variant="ghost" size="xs" onClick={() => setConfirmDelete(false)}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    data-testid="note-delete"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setConfirmDelete(true)}
                    title="Delete note"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>

            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-text-muted">
              <span>{formatRelative(note.createdAt)}</span>
              {note.sourceUrl && (
                <>
                  <span className="text-text-faint">·</span>
                  <button
                    onClick={handleOpenUrl}
                    className="flex items-center gap-1 truncate hover:text-text-primary"
                  >
                    <ExternalLink className="h-3 w-3" />
                    <span className="truncate">{note.sourceUrl}</span>
                  </button>
                </>
              )}
            </div>

            <NoteBody note={note} className="mt-2" />
          </>
        )}
      </div>
    </div>
  )
}
