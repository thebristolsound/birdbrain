import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note } from '@shared/types'
import { isEmptyNoteDocString, noteDocString } from '@shared/noteDoc'

const DEBOUNCE_MS = 1500

interface CreateArgs {
  title: string
  bodyDoc: string
}

interface UpdateArgs {
  id: string
  bodyDoc: string
}

export interface UseInlineNoteEditorArgs {
  notes: Note[]
  captureId: string
  captureTitle: string
  onCreate: (args: CreateArgs) => Promise<Note>
  onUpdate: (args: UpdateArgs) => Promise<Note | undefined>
}

function pickLatest(notes: Note[], captureId: string): Note | null {
  const filtered = notes.filter((n) => n.captureId === captureId)
  if (filtered.length === 0) return null
  return [...filtered].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

/**
 * Documents here are serialized ProseMirror JSON, not plain text. Comparisons
 * against the server copy go through noteDocString so a legacy plain-text note
 * is measured against the same lifted form the editor loads — otherwise
 * opening one would register as an edit and autosave would rewrite it.
 *
 * Typing never sets React state: `change` keeps a reader for the editor's
 * document and restarts the debounce, so a keystroke does not re-render the
 * host. `loaded` changes only when something outside the editor replaces its
 * document, and the host pushes that into the editor.
 */
export function useInlineNoteEditor({
  notes,
  captureId,
  captureTitle,
  onCreate,
  onUpdate
}: UseInlineNoteEditorArgs) {
  const latest = pickLatest(notes, captureId)
  const [localLatest, setLocalLatest] = useState<Note | null>(null)
  const effectiveLatest = latest ?? localLatest
  const boundNoteId = effectiveLatest?.id ?? null

  // The last server document we observed for the bound note. Used to detect
  // dirty state vs server, and to revert via Esc.
  const lastServerBodyRef = useRef<string>(noteDocString(effectiveLatest))
  const lastServerUpdatedRef = useRef<string>(effectiveLatest?.updatedAt ?? '')
  const lastBoundIdRef = useRef<string | null>(boundNoteId)
  const createInFlightRef = useRef<Promise<Note> | null>(null)

  // `revision` lets an Esc revert reload the editor even when the document it
  // reverts to is the one already loaded.
  const [loaded, setLoaded] = useState(() => ({
    doc: noteDocString(effectiveLatest),
    revision: 0
  }))
  const loadedDocRef = useRef(loaded.doc)
  // Null until the user edits after the last load: the editor still holds
  // `loaded`, which is cheaper to return than to re-serialize.
  const readEditedRef = useRef<(() => string) | null>(null)
  const debounceRef = useRef<number | null>(null)

  const currentDoc = useCallback(() => readEditedRef.current?.() ?? loadedDocRef.current, [])

  const cancelDebounce = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  const load = useCallback(
    (doc: string) => {
      cancelDebounce()
      readEditedRef.current = null
      loadedDocRef.current = doc
      setLoaded((prev) => ({ doc, revision: prev.revision + 1 }))
    },
    [cancelDebounce]
  )

  useEffect(() => {
    if (latest && localLatest && latest.id === localLatest.id) {
      setLocalLatest(null)
    }
  }, [latest, localLatest])

  // Server -> local sync: only when bound note id changes, or when the note's
  // updatedAt advances AND we have no local diff vs the prior server body.
  useEffect(() => {
    if (lastBoundIdRef.current !== boundNoteId) {
      lastBoundIdRef.current = boundNoteId
      lastServerBodyRef.current = noteDocString(effectiveLatest)
      lastServerUpdatedRef.current = effectiveLatest?.updatedAt ?? ''
      load(noteDocString(effectiveLatest))
      return
    }
    if (!effectiveLatest) return
    const advanced = effectiveLatest.updatedAt > lastServerUpdatedRef.current
    if (advanced && currentDoc() === lastServerBodyRef.current) {
      lastServerBodyRef.current = noteDocString(effectiveLatest)
      lastServerUpdatedRef.current = effectiveLatest.updatedAt
      load(noteDocString(effectiveLatest))
    }
  }, [effectiveLatest, boundNoteId, currentDoc, load])

  /**
   * Returns the id of the note the editor is bound to once the write settles,
   * or null when there is nothing to bind to (a blank editor with no note).
   * The id is what the selection Tag action needs (#391) — reading
   * `boundNoteId` after awaiting would give the render-time value, which for a
   * just-created note is still null.
   */
  const flush = useCallback(async (): Promise<string | null> => {
    cancelDebounce()
    const current = currentDoc()
    // Existing note: persist whatever the user has, even empty (no silent delete).
    if (boundNoteId) {
      if (current === lastServerBodyRef.current) return boundNoteId
      const updated = await onUpdate({ id: boundNoteId, bodyDoc: current })
      lastServerBodyRef.current = updated ? noteDocString(updated) : current
      if (updated?.updatedAt) {
        lastServerUpdatedRef.current = updated.updatedAt
      }
      return boundNoteId
    }
    // No note: blank blur is a no-op.
    if (isEmptyNoteDocString(current)) return null
    if (createInFlightRef.current) {
      const inFlight = await createInFlightRef.current
      return inFlight.id
    }
    const createPromise = onCreate({ title: captureTitle, bodyDoc: current })
    createInFlightRef.current = createPromise
    try {
      const created = await createPromise
      setLocalLatest(created)
      lastBoundIdRef.current = created.id
      lastServerBodyRef.current = noteDocString(created)
      lastServerUpdatedRef.current = created.updatedAt
      return created.id
    } finally {
      createInFlightRef.current = null
    }
  }, [boundNoteId, cancelDebounce, captureTitle, currentDoc, onCreate, onUpdate])

  // The debounce timer outlives the render that started it, so it calls the
  // latest flush rather than the one it closed over.
  const flushRef = useRef(flush)
  useEffect(() => {
    flushRef.current = flush
  }, [flush])
  useEffect(() => cancelDebounce, [cancelDebounce])

  const change = useCallback(
    (readDoc: () => string) => {
      readEditedRef.current = readDoc
      cancelDebounce()
      debounceRef.current = window.setTimeout(() => {
        debounceRef.current = null
        void flushRef.current().catch(() => {})
      }, DEBOUNCE_MS)
    },
    [cancelDebounce]
  )

  const revert = useCallback(() => {
    // A server copy held back because the draft was dirty applies now that
    // the draft is discarded.
    if (effectiveLatest && effectiveLatest.updatedAt > lastServerUpdatedRef.current) {
      lastServerBodyRef.current = noteDocString(effectiveLatest)
      lastServerUpdatedRef.current = effectiveLatest.updatedAt
    }
    load(lastServerBodyRef.current)
  }, [effectiveLatest, load])

  const isDirty = useCallback(
    () =>
      boundNoteId === null
        ? !isEmptyNoteDocString(currentDoc())
        : currentDoc() !== lastServerBodyRef.current,
    [boundNoteId, currentDoc]
  )

  return {
    loaded,
    currentDoc,
    change,
    flush,
    revert,
    isDirty,
    boundNoteId,
    savedAt: effectiveLatest?.updatedAt ?? null
  }
}
