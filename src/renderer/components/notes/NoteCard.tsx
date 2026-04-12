import { useState, useEffect } from 'react'
import { StickyNote, Pencil, Trash2, ExternalLink, X, Check } from 'lucide-react'
import type { Note } from '@shared/types'
import { useNotesMutations } from '@renderer/lib/queries'
import { Button, Input, Textarea } from '@renderer/components/ui'

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
}

export function NoteCard({ note, caseId }: NoteCardProps) {
  const { update, remove } = useNotesMutations(caseId)
  const [isEditing, setIsEditing] = useState(false)
  const [title, setTitle] = useState(note.title)
  const [body, setBody] = useState(note.body)
  const [thumbnail, setThumbnail] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    setTitle(note.title)
    setBody(note.body)
  }, [note.title, note.body])

  // screenshotPath column exists for Hunchly import compatibility but isn't rendered yet —
  // always fall back to the linked capture's thumbnail when a captureId is present.
  useEffect(() => {
    let isCurrent = true
    if (!note.captureId) {
      setThumbnail(null)
      return () => {
        isCurrent = false
      }
    }
    window.birdbrain.captures
      .getThumbnail(note.captureId)
      .then((next) => {
        if (isCurrent) setThumbnail(next)
      })
      .catch(() => {
        if (isCurrent) setThumbnail(null)
      })
    return () => {
      isCurrent = false
    }
  }, [note.captureId])

  async function handleSave() {
    await update.mutateAsync({ id: note.id, title, body })
    setIsEditing(false)
  }

  function handleCancel() {
    setTitle(note.title)
    setBody(note.body)
    setIsEditing(false)
  }

  async function handleDelete() {
    await remove.mutateAsync(note.id)
  }

  async function handleOpenUrl() {
    if (note.sourceUrl) {
      await window.birdbrain.captures.openExternal(note.sourceUrl)
    }
  }

  const displayTitle = note.title || '(Untitled note)'
  const thumbSrc = thumbnail ? `data:image/png;base64,${thumbnail}` : null

  return (
    <div
      data-testid={`note-card-${note.id}`}
      className="flex gap-3 rounded-2xl border border-border bg-surface p-4"
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
          <div className="space-y-2">
            <Input
              data-testid="note-title-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className="border-border bg-canvas font-semibold"
            />
            <Textarea
              data-testid="note-body-input"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Note body"
              rows={4}
              className="border-border bg-canvas text-text-secondary"
            />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="xs" onClick={handleCancel} className="gap-1">
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
              <Button
                data-testid="note-save"
                size="xs"
                onClick={handleSave}
                disabled={update.isPending}
                className="gap-1"
              >
                <Check className="h-3.5 w-3.5" />
                Save
              </Button>
            </div>
          </div>
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

            {note.body && (
              <p className="mt-2 whitespace-pre-wrap text-sm text-text-secondary">{note.body}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
