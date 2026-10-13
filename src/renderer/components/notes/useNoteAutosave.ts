import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note } from '@shared/types'
import { noteDocString } from '@shared/noteDoc'

export interface NoteDraft {
  title: string
  bodyDoc: string
}
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error'

const DEBOUNCE_MS = 700

/**
 * Serial writes keep a slow response from overwriting newer edits.
 *
 * The body is held as a reader for the editor's document, not a copy of it,
 * so a keystroke neither serializes the note nor re-renders the workspace.
 */
export function useNoteAutosave(
  note: Note,
  save: (draft: NoteDraft & { id: string }) => Promise<Note | undefined>
) {
  const [title, setTitle] = useState(note.title)
  const [savedAt, setSavedAt] = useState(note.updatedAt)
  const [state, setState] = useState<SaveState>('saved')
  // Mirrored so a keystroke that leaves the status unchanged skips setState:
  // React renders once more before it bails out of an identical update.
  const stateRef = useRef<SaveState>('saved')
  const setSaveState = useCallback((next: SaveState) => {
    if (stateRef.current === next) return
    stateRef.current = next
    setState(next)
  }, [])
  const initialBody = useRef(noteDocString(note))
  const currentTitle = useRef(note.title)
  const readBody = useRef(() => initialBody.current)
  const saved = useRef<NoteDraft>({ title: note.title, bodyDoc: initialBody.current })
  const inFlight = useRef<Promise<boolean> | null>(null)
  const timer = useRef<number | null>(null)
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  }, [save])

  const snapshot = useCallback(
    (): NoteDraft => ({ title: currentTitle.current, bodyDoc: readBody.current() }),
    []
  )
  const isSaved = useCallback(
    (draft: NoteDraft) =>
      draft.title === saved.current.title && draft.bodyDoc === saved.current.bodyDoc,
    []
  )
  const cancelTimer = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const flush = useCallback((): Promise<boolean> => {
    cancelTimer()
    if (inFlight.current) return inFlight.current
    const run = async () => {
      for (let draft = snapshot(); !isSaved(draft); draft = snapshot()) {
        setSaveState('saving')
        try {
          const result = await saveRef.current({ id: note.id, ...draft })
          if (!result) throw new Error('The note no longer exists')
          saved.current = draft
          setSavedAt(new Date().toISOString())
        } catch {
          setSaveState('error')
          return false
        }
      }
      setSaveState('saved')
      return true
    }
    const promise = run().finally(() => {
      inFlight.current = null
    })
    inFlight.current = promise
    return promise
  }, [cancelTimer, isSaved, note.id, setSaveState, snapshot])

  const schedule = useCallback(() => {
    cancelTimer()
    timer.current = window.setTimeout(() => {
      timer.current = null
      void flush()
    }, DEBOUNCE_MS)
  }, [cancelTimer, flush])
  useEffect(() => cancelTimer, [cancelTimer])

  const changeTitle = useCallback(
    (next: string) => {
      currentTitle.current = next
      setTitle(next)
      if (inFlight.current) {
        setSaveState('saving')
        schedule()
      } else if (isSaved(snapshot())) {
        setSaveState('saved')
        cancelTimer()
      } else {
        setSaveState('unsaved')
        schedule()
      }
    },
    [cancelTimer, isSaved, schedule, setSaveState, snapshot]
  )

  // Not compared against the saved copy here, which would serialize the note
  // per keystroke: an edit typed back to the original reads as unsaved until
  // the debounced flush finds nothing to write.
  const changeBody = useCallback(
    (read: () => string) => {
      readBody.current = read
      setSaveState(inFlight.current ? 'saving' : 'unsaved')
      schedule()
    },
    [schedule, setSaveState]
  )

  return { title, changeTitle, changeBody, flush, state, savedAt }
}
