import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note } from '@shared/types'
import { noteDocString } from '@shared/noteDoc'

export interface NoteDraft {
  title: string
  bodyDoc: string
}
export type SaveState = 'saved' | 'unsaved' | 'saving' | 'error'

/** Serial writes keep a slow response from overwriting newer edits. */
export function useNoteAutosave(
  note: Note,
  save: (draft: NoteDraft & { id: string }) => Promise<Note | undefined>
) {
  const initial = { title: note.title, bodyDoc: noteDocString(note) }
  const [draft, setDraft] = useState(initial)
  const [savedAt, setSavedAt] = useState(note.updatedAt)
  const [state, setState] = useState<SaveState>('saved')
  const current = useRef(initial)
  const saved = useRef(initial)
  const inFlight = useRef<Promise<boolean> | null>(null)
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  }, [save])

  const flush = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current
    const run = async () => {
      while (JSON.stringify(current.current) !== JSON.stringify(saved.current)) {
        const snapshot = current.current
        setState('saving')
        try {
          const result = await saveRef.current({ id: note.id, ...snapshot })
          if (!result) throw new Error('The note no longer exists')
          saved.current = snapshot
          setSavedAt(new Date().toISOString())
        } catch {
          setState('error')
          return false
        }
      }
      setState('saved')
      return true
    }
    const promise = run().finally(() => {
      inFlight.current = null
    })
    inFlight.current = promise
    return promise
  }, [note.id])

  const change = useCallback((patch: Partial<NoteDraft>) => {
    current.current = { ...current.current, ...patch }
    setDraft(current.current)
    setState(
      inFlight.current
        ? 'saving'
        : JSON.stringify(current.current) === JSON.stringify(saved.current)
          ? 'saved'
          : 'unsaved'
    )
  }, [])

  useEffect(() => {
    if (JSON.stringify(current.current) === JSON.stringify(saved.current)) return
    const timer = window.setTimeout(() => {
      void flush()
    }, 700)
    return () => window.clearTimeout(timer)
  }, [draft, flush])

  return { draft, change, flush, state, savedAt }
}
