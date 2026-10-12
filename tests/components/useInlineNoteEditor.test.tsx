// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Note } from '@shared/types'
import { useInlineNoteEditor } from '@renderer/components/captures/useInlineNoteEditor'
import { EMPTY_NOTE_DOC, noteDocToText, plainTextToNoteDoc } from '@shared/noteDoc'

const captureTitle = 'My capture'

/** The serialized document the editor holds for a given piece of text. */
function doc(text: string): string {
  return JSON.stringify(text ? plainTextToNoteDoc(text) : EMPTY_NOTE_DOC)
}

/** A note as stored since schema v26: rich body plus its derived plain text. */
function note(id: string, body: string, updatedAt: string): Note {
  return {
    id,
    caseId: 'case-1',
    captureId: 'cap-1',
    title: 't',
    body,
    bodyDoc: doc(body),
    createdAt: updatedAt,
    updatedAt
  }
}

/** A note written before rich text: plain body, no document. */
function legacyNote(id: string, body: string, updatedAt: string): Note {
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
    expect(result.current.currentDoc()).toBe(doc('newer'))
  })

  it('opens a legacy plain-text note clean, so autosave does not rewrite it', () => {
    const notes = [legacyNote('a', 'written before rich text', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )

    expect(noteDocToText(JSON.parse(result.current.currentDoc()))).toBe('written before rich text')
    expect(result.current.isDirty()).toBe(false)
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

  it('treats a document with only an empty paragraph as blank', async () => {
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes: [], captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    // What the editor serializes after the user types and deletes again.
    act(() => result.current.change(() => JSON.stringify(EMPTY_NOTE_DOC)))
    await act(async () => {
      await result.current.flush()
    })
    expect(onCreate).not.toHaveBeenCalled()
    expect(result.current.isDirty()).toBe(false)
  })

  it('non-empty save with zero notes creates with auto-title = capture title', async () => {
    const created = note('new-note', 'hello', '2026-02-02T00:00:00Z')
    const onCreate = vi.fn().mockResolvedValue(created)
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes: [], captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.change(() => doc('hello')))
    await act(async () => {
      await result.current.flush()
    })
    expect(onCreate).toHaveBeenCalledWith({ title: captureTitle, bodyDoc: doc('hello') })
    expect(result.current.boundNoteId).toBe('new-note')
  })

  // #391: the selection Tag action needs the id of the note it is about to
  // tag, and reading `boundNoteId` after awaiting gives the render-time value —
  // still null for a note this very call created.
  it('returns the id of the note it created', async () => {
    const created = note('new-note', 'hello', '2026-02-02T00:00:00Z')
    const onCreate = vi.fn().mockResolvedValue(created)
    const { result } = renderHook(() =>
      useInlineNoteEditor({
        notes: [],
        captureId: 'cap-1',
        captureTitle,
        onCreate,
        onUpdate: vi.fn()
      })
    )
    act(() => result.current.change(() => doc('hello')))
    let flushed: string | null = null
    await act(async () => {
      flushed = await result.current.flush()
    })
    expect(flushed).toBe('new-note')
  })

  it('returns the bound note id whether or not the flush had anything to write', async () => {
    const notes = [note('a', 'hi', '2026-02-01T00:00:00Z')]
    const onUpdate = vi.fn().mockResolvedValue(note('a', 'edited', '2026-02-03T00:00:00Z'))
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate: vi.fn(), onUpdate })
    )

    let clean: string | null = null
    await act(async () => {
      clean = await result.current.flush()
    })
    expect(clean).toBe('a')
    expect(onUpdate).not.toHaveBeenCalled()

    act(() => result.current.change(() => doc('edited')))
    let dirty: string | null = null
    await act(async () => {
      dirty = await result.current.flush()
    })
    expect(dirty).toBe('a')
    expect(onUpdate).toHaveBeenCalled()
  })

  it('returns null when there is no note and nothing to save', async () => {
    const { result } = renderHook(() =>
      useInlineNoteEditor({
        notes: [],
        captureId: 'cap-1',
        captureTitle,
        onCreate: vi.fn(),
        onUpdate: vi.fn()
      })
    )
    let flushed: string | null = 'unset'
    await act(async () => {
      flushed = await result.current.flush()
    })
    expect(flushed).toBeNull()
  })

  it('gates duplicate creates while initial create is in-flight', async () => {
    const created = note('new-note', 'hello', '2026-02-02T00:00:00Z')
    let resolveCreate: (n: Note) => void = () => {}
    const onCreate = vi.fn().mockImplementation(
      () =>
        new Promise<Note>((resolve) => {
          resolveCreate = resolve
        })
    )
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes: [], captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )

    act(() => result.current.change(() => doc('hello')))

    const firstFlush = result.current.flush()
    const secondFlush = result.current.flush()
    expect(onCreate).toHaveBeenCalledTimes(1)

    let ids: Array<string | null> = []
    await act(async () => {
      resolveCreate(created)
      ids = await Promise.all([firstFlush, secondFlush])
    })
    expect(result.current.boundNoteId).toBe('new-note')
    // Both callers learn the id, including the one that only waited on the
    // in-flight create (#391).
    expect(ids).toEqual(['new-note', 'new-note'])
  })

  it('saving an existing note with cleared body persists the empty document', async () => {
    const notes = [note('a', 'hi', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.change(() => doc('')))
    await act(async () => {
      await result.current.flush()
    })
    // Emptying an existing note is an edit, not a signal to leave it alone.
    expect(onUpdate).toHaveBeenCalledWith({ id: 'a', bodyDoc: doc('') })
  })

  it('debounce save fires after 1500ms of inactivity', async () => {
    const notes = [note('a', 'hi', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.change(() => doc('typed')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(onUpdate).toHaveBeenCalledWith({ id: 'a', bodyDoc: doc('typed') })
  })

  it('swallows debounced save rejection to avoid unhandled promise rejection', async () => {
    const notes = [note('a', 'hi', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn().mockRejectedValue(new Error('save failed'))
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.change(() => doc('typed')))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(onUpdate).toHaveBeenCalledWith({ id: 'a', bodyDoc: doc('typed') })
  })

  it('Esc reverts to last saved value', () => {
    const notes = [note('a', 'original', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn()
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.change(() => doc('changed')))
    expect(result.current.currentDoc()).toBe(doc('changed'))
    const before = result.current.loaded.revision
    act(() => result.current.revert())
    expect(result.current.currentDoc()).toBe(doc('original'))
    // The editor still shows the edit, so the revert must reload it even though
    // the document it reverts to is the one already loaded.
    expect(result.current.loaded).toEqual({ doc: doc('original'), revision: before + 1 })
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
    act(() => result.current.change(() => doc('local typing')))
    rerender({ notes: [note('a', 'server-updated', '2026-02-01T00:01:00Z')] })
    expect(result.current.currentDoc()).toBe(doc('local typing'))
    expect(result.current.loaded.doc).toBe(doc('server'))
  })

  it('applies a server copy held back by a dirty draft when the draft is reverted', () => {
    const initial = [note('a', 'server', '2026-02-01T00:00:00Z')]
    const { result, rerender } = renderHook(
      ({ notes }: { notes: Note[] }) =>
        useInlineNoteEditor({
          notes,
          captureId: 'cap-1',
          captureTitle,
          onCreate: vi.fn(),
          onUpdate: vi.fn()
        }),
      { initialProps: { notes: initial } }
    )
    act(() => result.current.change(() => doc('local typing')))
    rerender({ notes: [note('a', 'server-updated', '2026-02-01T00:01:00Z')] })
    act(() => result.current.revert())
    expect(result.current.loaded.doc).toBe(doc('server-updated'))
    expect(result.current.isDirty()).toBe(false)
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
    expect(result.current.currentDoc()).toBe(doc('server'))
    rerender({ notes: [note('a', 'server-updated', '2026-02-01T00:01:00Z')] })
    expect(result.current.currentDoc()).toBe(doc('server-updated'))
    expect(result.current.loaded.doc).toBe(doc('server-updated'))
  })

  it('keeps note dirty when update fails', async () => {
    const notes = [note('a', 'original', '2026-02-01T00:00:00Z')]
    const onCreate = vi.fn()
    const onUpdate = vi.fn().mockRejectedValue(new Error('failed'))
    const { result } = renderHook(() =>
      useInlineNoteEditor({ notes, captureId: 'cap-1', captureTitle, onCreate, onUpdate })
    )
    act(() => result.current.change(() => doc('changed')))
    await expect(result.current.flush()).rejects.toThrow('failed')
    expect(result.current.isDirty()).toBe(true)
    act(() => result.current.revert())
    expect(result.current.currentDoc()).toBe(doc('original'))
  })
  it('does not re-render the host or read the document while the user types', async () => {
    const notes = [note('a', 'hi', '2026-02-01T00:00:00Z')]
    const onUpdate = vi.fn().mockResolvedValue(undefined)
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useInlineNoteEditor({
        notes,
        captureId: 'cap-1',
        captureTitle,
        onCreate: vi.fn(),
        onUpdate
      })
    })
    const settled = renders
    const read = vi.fn(() => doc('typed'))
    act(() => {
      for (let i = 0; i < 20; i++) result.current.change(read)
    })
    expect(renders).toBe(settled)
    expect(read).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    // One debounced save reads the document once.
    expect(read).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledTimes(1)
  })

  it('drops a pending debounced save when the bound note changes', async () => {
    const onUpdate = vi.fn()
    const { result, rerender } = renderHook(
      ({ captureId }: { captureId: string }) =>
        useInlineNoteEditor({
          notes: [
            note('a', 'first', '2026-02-01T00:00:00Z'),
            { ...note('b', 'second', '2026-02-01T00:00:00Z'), captureId: 'cap-2' }
          ],
          captureId,
          captureTitle,
          onCreate: vi.fn(),
          onUpdate
        }),
      { initialProps: { captureId: 'cap-1' } }
    )
    act(() => result.current.change(() => doc('typed into first')))
    rerender({ captureId: 'cap-2' })
    expect(result.current.loaded.doc).toBe(doc('second'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500)
    })
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
