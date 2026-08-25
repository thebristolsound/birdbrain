// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Note } from '@shared/types'

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

import { CreateNoteCard } from '@renderer/components/notes/CreateNoteCard'
import { AddNoteModal } from '@renderer/components/notes/AddNoteModal'
import { fakeBridge } from '../renderer/fakeBridge'

const CASE_ID = 'case-1'

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}

function noteRow(id: string): Note {
  return {
    id,
    caseId: CASE_ID,
    title: 'draft',
    body: '',
    createdAt: '2026-08-24T00:00:00Z',
    updatedAt: '2026-08-24T00:00:00Z'
  }
}

interface Stubs {
  create: ReturnType<typeof vi.fn>
  update: ReturnType<typeof vi.fn>
  applyToNote: ReturnType<typeof vi.fn>
}

function stubBridge(): Stubs {
  const create = vi.fn(async () => noteRow('note-1'))
  const update = vi.fn(async () => noteRow('note-1'))
  const applyToNote = vi.fn(async () => ({ tag: { id: 't1', name: 'wire-transfer' } }))
  fakeBridge({
    notes: { create, update, list: vi.fn(async () => []) },
    captures: { list: vi.fn(async () => []) },
    selectors: { list: vi.fn(async () => []), matchCounts: vi.fn(async () => ({})) },
    tags: {
      list: vi.fn(async () => []),
      usageCountsForCase: vi.fn(async () => ({})),
      applyToNote
    }
  })
  return { create, update, applyToNote }
}

/**
 * jsdom has no selection model worth driving through ProseMirror, so the
 * native Selection is stubbed and the editor body's mouseup fired directly.
 * What is under test here is the draft lifecycle the Tag action forces, not
 * the geometry — that has its own test.
 */
function selectInEditor(text: string): void {
  const body = document.querySelector('[data-tour="noteeditor"]') as HTMLElement
  vi.spyOn(window, 'getSelection').mockReturnValue({
    isCollapsed: false,
    rangeCount: 1,
    anchorNode: body,
    removeAllRanges: vi.fn(),
    toString: () => text,
    getRangeAt: () => ({ getBoundingClientRect: () => ({ left: 0, bottom: 0 }) })
  } as unknown as Selection)
  fireEvent.mouseUp(body)
}

async function tagTheSelection(): Promise<void> {
  fireEvent.click(await screen.findByTestId('note-selection-tag'))
  await act(async () => {
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))
  })
}

/**
 * NotesOverview renders the card whether it is open or not, so closing it is a
 * prop flip rather than an unmount — which is the state the draft lifecycle has
 * to survive.
 */
function ToggleHarness() {
  const [open, setOpen] = useState(true)
  return (
    <CreateNoteCard
      caseId={CASE_ID}
      isOpen={open}
      onToggle={() => setOpen((v) => !v)}
      onCreated={() => setOpen(false)}
    />
  )
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(cleanup)

describe('CreateNoteCard draft tagging (#391)', () => {
  it('writes the draft out so the tag has a note to attach to, then updates on Save', async () => {
    const { create, update, applyToNote } = stubBridge()
    wrap(<CreateNoteCard caseId={CASE_ID} isOpen onToggle={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByTestId('create-note-title'), {
      target: { value: 'Wire transfer' }
    })

    selectInEditor('wire transfer')
    await tagTheSelection()

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(applyToNote).toHaveBeenCalledWith({ noteId: 'note-1', name: 'wire-transfer' })

    // Saving must not create a second note — the card is editing a real one now.
    await act(async () => {
      fireEvent.click(screen.getByTestId('create-note-submit'))
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'note-1', title: 'Wire transfer' })
    )
  })

  it('cancelling the draft does not leave Save pointed at the note it wrote out', async () => {
    const { create, update } = stubBridge()
    wrap(<ToggleHarness />)
    fireEvent.change(screen.getByTestId('create-note-title'), {
      target: { value: 'Wire transfer' }
    })

    selectInEditor('wire transfer')
    await tagTheSelection()
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByText('Cancel'))
    fireEvent.click(screen.getByTestId('notes-new-button'))
    fireEvent.change(screen.getByTestId('create-note-title'), { target: { value: 'Second' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('create-note-submit'))
    })

    // The tagged note keeps the body it was saved with; this is a new note.
    expect(update).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledTimes(2)
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Second' }))
  })

  it('abandons the cancelled draft rather than resuming it on reopen', async () => {
    stubBridge()
    wrap(<ToggleHarness />)
    fireEvent.change(screen.getByTestId('create-note-title'), { target: { value: 'Abandoned' } })

    fireEvent.click(screen.getByText('Cancel'))
    fireEvent.click(screen.getByTestId('notes-new-button'))

    expect((screen.getByTestId('create-note-title') as HTMLInputElement).value).toBe('')
  })

  it('still creates on Save when nothing was tagged', async () => {
    const { create, update } = stubBridge()
    wrap(<CreateNoteCard caseId={CASE_ID} isOpen onToggle={vi.fn()} onCreated={vi.fn()} />)
    fireEvent.change(screen.getByTestId('create-note-title'), { target: { value: 'Plain' } })

    await act(async () => {
      fireEvent.click(screen.getByTestId('create-note-submit'))
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('AddNoteModal draft tagging (#391)', () => {
  function renderModal() {
    return wrap(
      <AddNoteModal
        open
        caseId={CASE_ID}
        captureId="cap-1"
        captureTitle="Sign-in page"
        captureUrl="https://meridian-trust.example/login"
        onClose={vi.fn()}
      />
    )
  }

  it('writes the draft out against its capture, then updates on Save', async () => {
    const { create, update, applyToNote } = stubBridge()
    renderModal()

    selectInEditor('wire transfer')
    await tagTheSelection()

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    // captureId travels with the create, so main's R15 rule reaches the
    // capture as well as the note.
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ caseId: CASE_ID, captureId: 'cap-1' })
    )
    expect(applyToNote).toHaveBeenCalledWith({ noteId: 'note-1', name: 'wire-transfer' })

    await act(async () => {
      fireEvent.click(screen.getByTestId('add-note-submit'))
    })
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ id: 'note-1' }))
  })
})
