// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Note } from '@shared/types'
import { useInlineNoteEditor } from '@renderer/components/captures/useInlineNoteEditor'

const captureTitle = 'My capture'

function note(id: string, body: string, updatedAt: string): Note {
  return {
    id,
    caseId: 'case-1',
    captureId: 'cap-1',
    title: 't',
    body,
    createdAt: updatedAt,
    updatedAt
  }
}

describe('useInlineNoteEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('picks latest-by-updatedAt note as the bound note', () => {
    const notes = [
      note('a', 'older', '2026-01-01T00:00:00Z'),
      note('b', 'newer', '2026-02-01T00:00:00Z')
    ]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    expect(result.current.boundNoteId).toBe('b')
    expect(result.current.value).toBe('newer')
  })

  it('blank blur with zero notes is a no-op', async () => {
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes: [], captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    await act(async () => {
      await result.current.flush()
    })
    expect(onCreate).not.toHaveBeenCalled()
  })

  it('non-empty save with zero notes creates with auto-title = capture title', async () => {
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes: [], captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.setValue('hello'))
    await act(async () => {
      await result.current.flush()
    })
    expect(onCreate).toHaveBeenCalledWith({ title: captureTitle, body: 'hello' })
  })

  it('saving an existing note with cleared body persists empty body', async () => {
    const notes = [note('a', 'hi', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.setValue(''))
    await act(async () => {
      await result.current.flush()
    })
    expect(onUpdate).toHaveBeenCalledWith({ id: 'a', body: '' })
  })

  it('debounce save fires after 1500ms of inactivity', async () => {
    const notes = [note('a', 'hi', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.setValue('typed'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(onUpdate).toHaveBeenCalledWith({ id: 'a', body: 'typed' })
  })

  it('Esc reverts to last saved value', () => {
    const notes = [note('a', 'original', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.setValue('changed'))
    expect(result.current.value).toBe('changed')
    act(() => result.current.revert())
    expect(result.current.value).toBe('original')
  })

  it('does not stomp local edits when external update lands without our save', () => {
    const initial = [note('a', 'server', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result, rerender } = renderHook(
      ({ notes }: { notes: Note[] }) =>
        useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate }),
      { initialProps: { notes: initial } }
    )
    act(() => result.current.setValue('local typing'))
    rerender({ notes: [note('a', 'server-updated', '2026-02-01T00:01:00Z')] })
    expect(result.current.value).toBe('local typing')
  })

  it('syncs from server when local is clean and server bumps updatedAt', () => {
    const initial = [note('a', 'server', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result, rerender } = renderHook(
      ({ notes }: { notes: Note[] }) =>
        useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate }),
      { initialProps: { notes: initial } }
    )
    expect(result.current.value).toBe('server')
    rerender({ notes: [note('a', 'server-updated', '2026-02-01T00:01:00Z')] })
    expect(result.current.value).toBe('server-updated')
  })
})
