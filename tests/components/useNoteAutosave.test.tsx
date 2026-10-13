import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNoteAutosave } from '@renderer/components/notes/useNoteAutosave'
import type { Note } from '@shared/types'

const note: Note = {
  id: 'n1',
  caseId: 'c1',
  title: 'Original',
  body: 'Legacy text',
  createdAt: '2026-09-20T00:00:00Z',
  updatedAt: '2026-09-20T00:00:00Z'
}
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('workspace autosave', () => {
  it('does not rewrite a legacy note merely opened, then saves an edited title after the debounce', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (draft) => ({ ...note, ...draft }))
    const { result } = renderHook(() => useNoteAutosave(note, save))
    await act(async () => {
      await result.current.flush()
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(save).not.toHaveBeenCalled()
    act(() => result.current.changeTitle('Edited'))
    expect(result.current.state).toBe('unsaved')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(save).toHaveBeenCalledWith({
      id: 'n1',
      title: 'Edited',
      bodyDoc: JSON.stringify({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Legacy text' }] }]
      })
    })
    expect(result.current.state).toBe('saved')
  })

  it('recognizes edits reverted before saving as clean without writing the note', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async () => note)
    const { result } = renderHook(() => useNoteAutosave(note, save))
    act(() => result.current.changeTitle('Temporary edit'))
    act(() => result.current.changeTitle('Original'))
    expect(result.current.state).toBe('saved')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(save).not.toHaveBeenCalled()
  })

  it('serializes edits made during an outstanding write and shares concurrent flushes', async () => {
    let finish!: (value: Note) => void
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Note>((resolve) => {
            finish = resolve
          })
      )
      .mockImplementation(async (draft) => ({ ...note, ...draft }))
    const { result } = renderHook(() => useNoteAutosave(note, save))
    act(() => result.current.changeTitle('First'))
    let first!: Promise<boolean>
    act(() => {
      first = result.current.flush()
    })
    expect(result.current.state).toBe('saving')
    expect(result.current.flush()).toBe(first)
    act(() => result.current.changeTitle('Latest'))
    await act(async () => {
      finish({ ...note, title: 'First' })
      await first
    })
    expect(save.mock.calls.map(([value]) => value.title)).toEqual(['First', 'Latest'])
    expect(result.current.state).toBe('saved')
  })

  it('keeps failed drafts retryable and blocks a switch until persistence succeeds', async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error('Disk full'))
      .mockResolvedValueOnce(undefined)
      .mockResolvedValue(note)
    const { result } = renderHook(() => useNoteAutosave(note, save))
    act(() => result.current.changeTitle('Keep this'))
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(false)
    expect(result.current.state).toBe('error')
    expect(result.current.title).toBe('Keep this')
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(false)
    await act(async () => {
      ok = await result.current.flush()
    })
    expect(ok).toBe(true)
    expect(result.current.state).toBe('saved')
  })
  it('saves a body edit read once at the debounce, without re-rendering per keystroke', async () => {
    vi.useFakeTimers()
    const save = vi.fn(async (draft) => ({ ...note, ...draft }))
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useNoteAutosave(note, save)
    })
    const body = JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] })
    const read = vi.fn(() => body)
    act(() => result.current.changeBody(read))
    expect(result.current.state).toBe('unsaved')
    const afterFirst = renders
    act(() => {
      for (let i = 0; i < 20; i++) result.current.changeBody(read)
    })
    expect(renders).toBe(afterFirst)
    expect(read).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(700)
    })
    expect(save).toHaveBeenCalledWith({ id: 'n1', title: 'Original', bodyDoc: body })
    expect(result.current.state).toBe('saved')
  })
})
