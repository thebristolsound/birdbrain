// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useAnnotationEditor } from '@renderer/components/captures/annotation/useAnnotationEditor'

describe('useAnnotationEditor', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('initialises with select tool and given shapes', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    expect(result.current.tool).toBe('select')
    expect(result.current.shapes).toEqual([])
    expect(result.current.dirty).toBe(false)
  })

  it('beginDraft + commitDraft adds a shape and pushes to undo stack', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    act(() => result.current.setTool('rect'))
    act(() =>
      result.current.beginDraft({
        kind: 'rect',
        id: 's1',
        x: 5,
        y: 5,
        w: 0,
        h: 0,
        stroke: '#f00',
        strokeWidth: 2
      })
    )
    act(() => result.current.extendDraft({ w: 20, h: 30 }))
    act(() => result.current.commitDraft())
    expect(result.current.shapes).toHaveLength(1)
    expect(result.current.shapes[0]).toMatchObject({ w: 20, h: 30 })
    expect(result.current.dirty).toBe(true)
  })

  it('undo restores previous shape state, redo re-applies', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    act(() =>
      result.current.beginDraft({
        kind: 'rect',
        id: 's1',
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        stroke: '#000',
        strokeWidth: 1
      })
    )
    act(() => result.current.commitDraft())
    expect(result.current.shapes).toHaveLength(1)
    act(() => result.current.undo())
    expect(result.current.shapes).toHaveLength(0)
    act(() => result.current.redo())
    expect(result.current.shapes).toHaveLength(1)
  })

  it('persists last-used color and strokeWidth to localStorage', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    act(() => result.current.setColor('#0000ff'))
    act(() => result.current.setStrokeWidth(7))
    expect(localStorage.getItem('birdbrain.annotation.color')).toBe('#0000ff')
    expect(localStorage.getItem('birdbrain.annotation.strokeWidth')).toBe('7')
  })

  it('reads last-used color and strokeWidth from localStorage on mount', () => {
    localStorage.setItem('birdbrain.annotation.color', '#0000ff')
    localStorage.setItem('birdbrain.annotation.strokeWidth', '7')
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    expect(result.current.color).toBe('#0000ff')
    expect(result.current.strokeWidth).toBe(7)
  })

  it('removeShape pushes to undo and clears selection if the shape was selected', () => {
    const { result } = renderHook(() =>
      useAnnotationEditor({
        initialShapes: [
          { kind: 'rect', id: 's1', x: 0, y: 0, w: 1, h: 1, stroke: '#000', strokeWidth: 1 }
        ]
      })
    )
    act(() => result.current.select('s1'))
    act(() => result.current.removeShape('s1'))
    expect(result.current.shapes).toHaveLength(0)
    expect(result.current.selectedId).toBeNull()
    act(() => result.current.undo())
    expect(result.current.shapes).toHaveLength(1)
  })

  it('discardShape removes a shape from the canvas and from undo and redo', () => {
    const keep = { kind: 'pin' as const, id: 'keep', pinId: 'p1', number: 1, x: 0, y: 0 }
    const gone = { kind: 'pin' as const, id: 'gone', pinId: 'p2', number: 2, x: 5, y: 5 }
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [keep] }))
    act(() => result.current.beginDraft(gone))
    act(() => result.current.commitDraft())
    act(() => result.current.updateShape({ ...gone, x: 9 }))
    act(() => result.current.undo())
    act(() => result.current.select('gone'))
    act(() => result.current.discardShape('gone'))

    expect(result.current.shapes).toEqual([keep])
    expect(result.current.selectedId).toBeNull()
    expect(result.current.dirty).toBe(true)
    act(() => result.current.redo())
    expect(result.current.shapes).toEqual([keep])
    act(() => result.current.undo())
    act(() => result.current.undo())
    expect(result.current.shapes).toEqual([keep])
  })

  it('discardShape keeps a moved shape out of undo and re-marks a saved editor dirty', () => {
    const keep = { kind: 'pin' as const, id: 'keep', pinId: 'p1', number: 1, x: 0, y: 0 }
    const gone = { kind: 'pin' as const, id: 'gone', pinId: 'p2', number: 2, x: 5, y: 5 }
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [keep] }))
    act(() => result.current.beginDraft(gone))
    act(() => result.current.commitDraft())
    act(() => result.current.updateShape({ ...gone, x: 9 }))
    act(() => result.current.clearDirty())
    act(() => result.current.discardShape('gone'))

    expect(result.current.dirty).toBe(true)
    act(() => result.current.undo())
    expect(result.current.shapes).toEqual([keep])
  })

  it('discardShape leaves no undo step that changes nothing', () => {
    const keep = { kind: 'pin' as const, id: 'keep', pinId: 'p1', number: 1, x: 0, y: 0 }
    const gone = { kind: 'pin' as const, id: 'gone', pinId: 'p2', number: 2, x: 5, y: 5 }
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [keep] }))
    act(() => result.current.updateShape({ ...keep, x: 3 }))
    act(() => result.current.beginDraft(gone))
    act(() => result.current.commitDraft())
    act(() => result.current.discardShape('gone'))

    // One press undoes the move made before the pin was dropped.
    act(() => result.current.undo())
    expect(result.current.shapes).toEqual([keep])
    expect(result.current.canUndo).toBe(false)
  })

  it('cancelDraft clears the draft without committing', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    act(() =>
      result.current.beginDraft({
        kind: 'rect',
        id: 's1',
        x: 0,
        y: 0,
        w: 5,
        h: 5,
        stroke: '#000',
        strokeWidth: 1
      })
    )
    expect(result.current.draft).not.toBeNull()
    act(() => result.current.cancelDraft())
    expect(result.current.draft).toBeNull()
    expect(result.current.shapes).toHaveLength(0)
    expect(result.current.dirty).toBe(false)
  })

  it('updateShape replaces a shape by id and pushes to undo', () => {
    const { result } = renderHook(() =>
      useAnnotationEditor({
        initialShapes: [
          { kind: 'rect', id: 's1', x: 0, y: 0, w: 10, h: 10, stroke: '#000', strokeWidth: 1 }
        ]
      })
    )
    act(() =>
      result.current.updateShape({
        kind: 'rect',
        id: 's1',
        x: 50,
        y: 60,
        w: 10,
        h: 10,
        stroke: '#000',
        strokeWidth: 1
      })
    )
    expect(result.current.shapes[0]).toMatchObject({ x: 50, y: 60 })
    expect(result.current.dirty).toBe(true)
    act(() => result.current.undo())
    expect(result.current.shapes[0]).toMatchObject({ x: 0, y: 0 })
  })

  it('canUndo and canRedo reflect stack state', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    act(() =>
      result.current.beginDraft({
        kind: 'rect',
        id: 's1',
        x: 0,
        y: 0,
        w: 1,
        h: 1,
        stroke: '#000',
        strokeWidth: 1
      })
    )
    act(() => result.current.commitDraft())
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
    act(() => result.current.undo())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)
  })

  it('accepts the hand tool', () => {
    const { result } = renderHook(() => useAnnotationEditor({ initialShapes: [] }))
    act(() => result.current.setTool('hand'))
    expect(result.current.tool).toBe('hand')
  })
})
