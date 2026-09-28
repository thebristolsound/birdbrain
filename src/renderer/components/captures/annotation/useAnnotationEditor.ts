import { useCallback, useRef, useState } from 'react'
import type { AnnotationShape } from '@shared/types'

export type AnnotationTool = 'select' | 'rect' | 'arrow' | 'highlight' | 'redact' | 'pin' | 'hand'

const COLOR_KEY = 'birdbrain.annotation.color'
const STROKE_KEY = 'birdbrain.annotation.strokeWidth'
const DEFAULT_COLOR = '#ef4444'
const DEFAULT_STROKE = 3

function readColor(): string {
  return localStorage.getItem(COLOR_KEY) ?? DEFAULT_COLOR
}
function readStroke(): number {
  const raw = localStorage.getItem(STROKE_KEY)
  if (!raw) return DEFAULT_STROKE
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_STROKE
}

function sameShapes(a: AnnotationShape[], b: AnnotationShape[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i])
}

// Taking a shape out of every snapshot can leave a snapshot equal to the step
// after it, or to the canvas, which would make an undo press that changes nothing.
function pruneHistory(stack: AnnotationShape[][], current: AnnotationShape[]) {
  return stack.filter((snap, i) => !sameShapes(snap, stack[i + 1] ?? current))
}

interface Options {
  initialShapes: AnnotationShape[]
}

export function useAnnotationEditor({ initialShapes }: Options) {
  const [tool, setTool] = useState<AnnotationTool>('select')
  const [color, setColorState] = useState<string>(() => readColor())
  const [strokeWidth, setStrokeWidthState] = useState<number>(() => readStroke())
  const [shapes, setShapes] = useState<AnnotationShape[]>(initialShapes)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraftState] = useState<AnnotationShape | null>(null)
  // Mirrors `draft` so commitDraft can read a draft begun in the same batch
  // without reaching into a state updater, which StrictMode runs twice.
  const draftRef = useRef<AnnotationShape | null>(null)
  const setDraft = useCallback((d: AnnotationShape | null) => {
    draftRef.current = d
    setDraftState(d)
  }, [])
  const [undoStack, setUndoStack] = useState<AnnotationShape[][]>([])
  const [redoStack, setRedoStack] = useState<AnnotationShape[][]>([])
  const [dirty, setDirty] = useState(false)

  const setColor = useCallback((c: string) => {
    setColorState(c)
    localStorage.setItem(COLOR_KEY, c)
  }, [])
  const setStrokeWidth = useCallback((w: number) => {
    setStrokeWidthState(w)
    localStorage.setItem(STROKE_KEY, String(w))
  }, [])

  const beginDraft = useCallback((shape: AnnotationShape) => setDraft(shape), [setDraft])
  const extendDraft = useCallback(
    (patch: Partial<Omit<AnnotationShape, 'kind' | 'id'>>) => {
      const d = draftRef.current
      if (d) setDraft({ ...d, ...patch } as AnnotationShape)
    },
    [setDraft]
  )
  const cancelDraft = useCallback(() => setDraft(null), [setDraft])

  const commitDraft = useCallback(() => {
    const d = draftRef.current
    if (!d) return
    setDraft(null)
    setUndoStack((s) => [...s, shapes])
    setRedoStack([])
    setShapes((arr) => [...arr, d])
    setDirty(true)
  }, [shapes, setDraft])

  const updateShape = useCallback(
    (next: AnnotationShape) => {
      setUndoStack((s) => [...s, shapes])
      setRedoStack([])
      setShapes((arr) => arr.map((s) => (s.id === next.id ? next : s)))
      setDirty(true)
    },
    [shapes]
  )

  const removeShape = useCallback(
    (id: string) => {
      setUndoStack((s) => [...s, shapes])
      setRedoStack([])
      setShapes((arr) => arr.filter((s) => s.id !== id))
      setSelectedId((prev) => (prev === id ? null : prev))
      setDirty(true)
    },
    [shapes]
  )

  // For a shape whose backing record no longer exists, such as a pin cancelled
  // before its note was added: undo must not restore it, so it leaves the
  // history as well as the canvas.
  const discardShape = useCallback(
    (id: string) => {
      const without = (arr: AnnotationShape[]) => arr.filter((s) => s.id !== id)
      const next = without(shapes)
      setShapes(next)
      setUndoStack((stack) => pruneHistory(stack.map(without), next))
      setRedoStack((stack) => pruneHistory(stack.map(without), next))
      setSelectedId((prev) => (prev === id ? null : prev))
      setDirty(true)
    },
    [shapes]
  )

  const undo = useCallback(() => {
    setUndoStack((stack) => {
      if (stack.length === 0) return stack
      const prev = stack[stack.length - 1]
      setRedoStack((r) => [...r, shapes])
      setShapes(prev)
      setDirty(true)
      return stack.slice(0, -1)
    })
  }, [shapes])

  const redo = useCallback(() => {
    setRedoStack((stack) => {
      if (stack.length === 0) return stack
      const next = stack[stack.length - 1]
      setUndoStack((u) => [...u, shapes])
      setShapes(next)
      setDirty(true)
      return stack.slice(0, -1)
    })
  }, [shapes])

  const select = useCallback((id: string | null) => setSelectedId(id), [])
  const clearDirty = useCallback(() => setDirty(false), [])

  // Note: there is intentionally no `useEffect` that resets state when
  // `initialShapes` changes. Reset-on-prop-change is a footgun because callers
  // often pass a new array reference on every render. Instead, the parent must
  // remount this hook by giving the owning component a stable `key` (e.g.
  // `key={captureId}`). See Task 12 — `<AnnotationEditor key={captureId} ... />`.

  return {
    tool,
    setTool,
    color,
    setColor,
    strokeWidth,
    setStrokeWidth,
    shapes,
    setShapes,
    selectedId,
    select,
    draft,
    beginDraft,
    extendDraft,
    cancelDraft,
    commitDraft,
    updateShape,
    removeShape,
    discardShape,
    undo,
    redo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    dirty,
    clearDirty
  }
}
