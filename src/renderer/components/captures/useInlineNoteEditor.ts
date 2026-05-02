import { useCallback, useEffect, useRef, useState } from 'react'
import type { Note } from '@shared/types'

const DEBOUNCE_MS = 1500

interface CreateArgs {
  title: string
  body: string
}

interface UpdateArgs {
  id: string
  body: string
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

  // The last server body we observed for the bound note. Used to detect dirty
  // state vs server, and to revert via Esc.
  const lastServerBodyRef = useRef<string>(effectiveLatest?.body ?? '')
  const lastServerUpdatedRef = useRef<string>(effectiveLatest?.updatedAt ?? '')
  const lastBoundIdRef = useRef<string | null>(boundNoteId)
  const createInFlightRef = useRef<Promise<Note> | null>(null)

  const [value, setValue] = useState<string>(effectiveLatest?.body ?? '')
  const debounceRef = useRef<number | null>(null)

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
      lastServerBodyRef.current = effectiveLatest?.body ?? ''
      lastServerUpdatedRef.current = effectiveLatest?.updatedAt ?? ''
      setValue(effectiveLatest?.body ?? '')
      return
    }
    if (!effectiveLatest) return
    const advanced = effectiveLatest.updatedAt > lastServerUpdatedRef.current
    const localClean = value === lastServerBodyRef.current
    if (advanced && localClean) {
      lastServerBodyRef.current = effectiveLatest.body
      lastServerUpdatedRef.current = effectiveLatest.updatedAt
      setValue(effectiveLatest.body)
    }
  }, [effectiveLatest, boundNoteId, value])

  const flush = useCallback(async (): Promise<void> => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const current = value
    // Existing note: persist whatever the user has, even empty (no silent delete).
    if (boundNoteId) {
      if (current === lastServerBodyRef.current) return
      const updated = await onUpdate({ id: boundNoteId, body: current })
      lastServerBodyRef.current = updated?.body ?? current
      if (updated?.updatedAt) {
        lastServerUpdatedRef.current = updated.updatedAt
      }
      return
    }
    // No note: blank blur is a no-op.
    const trimmed = current.trim()
    if (trimmed.length === 0) return
    if (createInFlightRef.current) {
      await createInFlightRef.current
      return
    }
    const createPromise = onCreate({ title: captureTitle, body: current })
    createInFlightRef.current = createPromise
    try {
      const created = await createPromise
      setLocalLatest(created)
      lastBoundIdRef.current = created.id
      lastServerBodyRef.current = created.body
      lastServerUpdatedRef.current = created.updatedAt
    } finally {
      createInFlightRef.current = null
    }
  }, [boundNoteId, captureTitle, onCreate, onUpdate, value])

  // Debounce on every value change.
  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current)
    }
    if (boundNoteId === null && value.trim().length === 0) return
    if (boundNoteId !== null && value === lastServerBodyRef.current) return
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      void flush().catch(() => {})
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [value, boundNoteId, flush])

  const revert = useCallback(() => {
    setValue(lastServerBodyRef.current)
  }, [])

  const isDirty =
    boundNoteId === null ? value.trim().length > 0 : value !== lastServerBodyRef.current

  return {
    value,
    setValue,
    flush,
    revert,
    isDirty,
    boundNoteId,
    savedAt: effectiveLatest?.updatedAt ?? null
  }
}
