import { useEffect, useState, type MutableRefObject } from 'react'
import { useBlocker, useNavigate } from '@tanstack/react-router'
import { Camera, PanelRight, Trash2 } from 'lucide-react'
import type { Note } from '@shared/types'
import type { MentionTargetType } from '@shared/noteDoc'
import { useNotesMutations } from '@renderer/lib/api/notes'
import { useAppStore } from '@renderer/stores/appStore'
import { NoteEditor } from './NoteEditor'
import { useNoteEditor } from './useNoteEditor'
import { useNoteAutosave } from './useNoteAutosave'
import { noteAge, noteMentions } from './notesWorkspaceModel'
import { useMentionResolver } from './mention/useMentionSources'
import { mentionRoute, mentionSelection } from './mention/mentionModel'

export interface NoteWorkspaceDetailProps {
  requestDelete?: boolean
  clearDeleteRequest?: () => void
  note: Note
  notes: Note[]
  flushRef: MutableRefObject<(() => Promise<boolean>) | null>
  onDelete: (id: string) => Promise<void>
}

export function NoteWorkspaceDetail({
  note,
  notes,
  flushRef,
  onDelete,
  requestDelete,
  clearDeleteRequest
}: NoteWorkspaceDetailProps) {
  const { update } = useNotesMutations(note.caseId)
  const { draft, change, state, flush, savedAt } = useNoteAutosave(note, update.mutateAsync)
  const editor = useNoteEditor({
    caseId: note.caseId,
    noteId: note.id,
    bodyDoc: note.bodyDoc,
    plainText: note.body,
    onChange: (bodyDoc) => change({ bodyDoc }),
    testId: 'note-body-input'
  })
  const navigate = useNavigate()
  const resolve = useMentionResolver(note.caseId)
  const [railOpen, setRailOpen] = useState(true)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    if (requestDelete) {
      setConfirmDelete(true)
      clearDeleteRequest?.()
    }
  }, [requestDelete, clearDeleteRequest])
  useEffect(() => {
    flushRef.current = flush
    return () => {
      flushRef.current = null
    }
  }, [flushRef, flush])
  useBlocker({ shouldBlockFn: async () => !(await flush()), enableBeforeUnload: state !== 'saved' })

  async function openTarget(type: MentionTargetType, id: string) {
    if (!(await flush())) return
    const store = useAppStore.getState()
    const selection = mentionSelection(type)
    if (selection === 'capture') store.setSelectedCaptureId(id)
    else if (selection === 'note') store.setSelectedNoteId(id)
    else store.setSelectedSignalId(id)
    void navigate({ to: mentionRoute(type), params: { caseId: note.caseId } })
  }
  const mentions = noteMentions(draft.bodyDoc)
  const outgoing = [...new Map(mentions.map((m) => [`${m.targetType}:${m.targetId}`, m])).values()]
  const incoming = notes.filter(
    (n) =>
      n.id !== note.id &&
      noteMentions(n.bodyDoc).some((m) => m.targetType === 'note' && m.targetId === note.id)
  )

  return (
    <main
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-canvas"
      aria-label="Note workspace"
    >
      <header className="border-b border-border px-7 pb-3 pt-5">
        <input
          aria-label="Note title"
          data-testid="note-title-input"
          value={draft.title}
          placeholder="Untitled note"
          onChange={(e) => change({ title: e.target.value })}
          onBlur={() => void flush()}
          className="w-full border-0 bg-transparent font-display text-[22px] font-extrabold tracking-tight text-text-primary outline-none"
        />
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-faint">
          <span>{noteAge(note.createdAt)}</span>
          {note.captureId ? (
            <button
              title="Open linked capture"
              onClick={() => void openTarget('capture', note.captureId!)}
              className="inline-flex max-w-[280px] items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-[10px] text-text-muted hover:text-accent"
            >
              <Camera className="h-3 w-3 shrink-0" />
              <span className="truncate">{note.sourceUrl || 'Linked capture'}</span>
            </button>
          ) : null}
          <span className="flex-1" />
          <button
            title="Toggle note context"
            aria-label="Toggle note context"
            aria-expanded={railOpen}
            onClick={() => setRailOpen((v) => !v)}
            className="rounded p-1 hover:bg-elevated"
          >
            <PanelRight className="h-3.5 w-3.5" />
          </button>
          {confirmDelete ? (
            <>
              <button
                data-testid="note-confirm-delete"
                onClick={async () => {
                  if (await flush()) await onDelete(note.id)
                }}
                className="text-red-400"
              >
                Confirm delete
              </button>
              <button onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>
          ) : (
            <button
              data-testid="note-delete"
              title="Delete note"
              aria-label="Delete note"
              onClick={() => setConfirmDelete(true)}
              className="rounded p-1 hover:bg-elevated"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <NoteEditor
            editor={editor}
            workspace
            placeholder="Start writing — type @ to link captures and notes, # for selectors and tags."
            minHeightClass="min-h-64"
            onBlur={() => void flush()}
            selectionActions={{
              caseId: note.caseId,
              resolveNoteId: async () => {
                if (!(await flush())) throw new Error('Save the note before tagging it')
                return note.id
              }
            }}
          />
        </div>
        {railOpen ? (
          <aside
            aria-label="Note context"
            className="w-60 shrink-0 overflow-y-auto border-l border-border bg-surface/60 p-4"
          >
            <h2 className="font-display text-xs font-semibold text-text-primary">Context</h2>
            <details open className="mt-5">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Links out · {outgoing.length}
              </summary>
              {outgoing.length ? (
                outgoing.map((m) => {
                  const target = resolve(m.targetType, m.targetId)
                  return (
                    <button
                      key={`${m.targetType}:${m.targetId}`}
                      disabled={target.status !== 'resolved'}
                      onClick={() => void openTarget(m.targetType, m.targetId)}
                      className="mt-2 block w-full truncate rounded px-2 py-1 text-left text-xs text-text-secondary hover:bg-elevated disabled:opacity-50"
                    >
                      {target.label || m.label}{' '}
                      <span className="text-text-faint">
                        · {target.status === 'missing' ? 'Deleted' : m.targetType}
                      </span>
                    </button>
                  )
                })
              ) : (
                <p className="mt-2 text-[11px] text-text-faint">
                  This note doesn’t link to anything yet.
                </p>
              )}
            </details>
            <details open className="mt-5">
              <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Linked mentions · {incoming.length}
              </summary>
              {incoming.length ? (
                incoming.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => void openTarget('note', n.id)}
                    className="mt-2 block w-full border-l-2 border-accent/45 bg-surface p-2 text-left text-xs"
                  >
                    <span className="block truncate font-semibold text-text-primary">
                      {n.title || 'Untitled note'}
                    </span>
                    <span className="line-clamp-2 text-[11px] text-text-muted">{n.body}</span>
                  </button>
                ))
              ) : (
                <p className="mt-2 text-[11px] text-text-faint">Nothing links here yet.</p>
              )}
            </details>
          </aside>
        ) : null}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-7 py-2 text-[10px] text-text-faint">
        <span>
          Markdown · TipTap editor ·{' '}
          <kbd className="rounded border border-border px-1 font-mono">@</kbd> links captures &amp;
          notes · <kbd className="rounded border border-border px-1 font-mono">#</kbd> selectors
          &amp; tags
        </span>
        <span role="status">
          {state === 'saved'
            ? `Saved ${noteAge(savedAt)}`
            : state === 'saving'
              ? 'Saving…'
              : state === 'error'
                ? 'Could not save'
                : 'Unsaved changes'}
          {state === 'error' ? (
            <button className="ml-2 text-accent" onClick={() => void flush()}>
              Retry save
            </button>
          ) : null}
        </span>
      </footer>
    </main>
  )
}
