import { useCallback, useState } from 'react'
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

interface Options {
  initialShapes: AnnotationShape[]
}

export function useAnnotationEditor({ initialShapes }: Options) {
  const [tool, setTool] = useState<AnnotationTool>('select')
  const [color, setColorState] = useState<string>(() => readColor())
  const [strokeWidth, setStrokeWidthState] = useState<number>(() => readStroke())
  const [shapes, setShapes] = useState<AnnotationShape[]>(initialShapes)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AnnotationShape | null>(null)
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

  const beginDraft = useCallback((shape: AnnotationShape) => setDraft(shape), [])
  const extendDraft = useCallback((patch: Partial<Omit<AnnotationShape, 'kind' | 'id'>>) => {
    setDraft((d) => (d ? ({ ...d, ...patch } as AnnotationShape) : d))
  }, [])
  const cancelDraft = useCallback(() => setDraft(null), [])

  const commitDraft = useCallback(() => {
    setDraft((d) => {
      if (!d) return null
      setUndoStack((s) => [...s, shapes])
      setRedoStack([])
      setShapes((arr) => [...arr, d])
      setDirty(true)
      return null
    })
  }, [shapes])

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
  const discardShape = useCallback((id: string) => {
    const without = (arr: AnnotationShape[]) => arr.filter((s) => s.id !== id)
    setShapes(without)
    setUndoStack((stack) => stack.map(without))
    setRedoStack((stack) => stack.map(without))
    setSelectedId((prev) => (prev === id ? null : prev))
    setDirty(true)
  }, [])

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
