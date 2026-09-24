// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const notifySuccess = vi.hoisted(() => vi.fn())
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: notifySuccess, info: vi.fn() }
}))

import {
  NoteSelectionBar,
  NoteSelectionConfirm
} from '@renderer/components/notes/selection/NoteSelectionPopover'
import { NoteSelectionOverlay } from '@renderer/components/notes/selection/NoteSelectionOverlay'
import type { NoteSelectionState } from '@renderer/components/notes/selection/useNoteSelection'
import { RETRO_MAX_CAPTURES } from '@shared/constants'
import { queryKeys } from '@renderer/lib/api/keys'
import { fakeBridge } from '../renderer/fakeBridge'

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{children}</QueryClientProvider>)
}

const confirmState = (
  over: Partial<NoteSelectionState> = {}
): NoteSelectionState => ({
  text: 'meridian-trust.com',
  step: 'confirm',
  mode: 'selector',
  x: 12,
  y: 40,
  ...over
})

beforeEach(() => {
  notifySuccess.mockClear()
  notifyError.mockClear()
})

afterEach(cleanup)

describe('NoteSelectionBar', () => {
  it('offers exactly two actions — no Quote, because this is already a note', () => {
    const onChoose = vi.fn()
    render(<NoteSelectionBar x={10} y={20} onChoose={onChoose} />)

    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Selector', 'Tag'])

    fireEvent.click(screen.getByTestId('note-selection-tag'))
    expect(onChoose).toHaveBeenCalledWith('tag')
  })

  it('does not let a button steal focus from the selection it acts on', () => {
    render(<NoteSelectionBar x={10} y={20} onChoose={vi.fn()} />)
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    fireEvent(screen.getByTestId('note-selection-selector'), event)
    expect(event.defaultPrevented).toBe(true)
  })
})

describe('NoteSelectionConfirm', () => {
  function renderConfirm(over: Partial<Parameters<typeof NoteSelectionConfirm>[0]> = {}) {
    return render(
      <NoteSelectionConfirm
        x={0}
        y={0}
        text="meridian-trust.com"
        mode="selector"
        watch
        pending={false}
        onToggleWatch={vi.fn()}
        onCancel={vi.fn()}
        onConfirm={vi.fn()}
        {...over}
      />
    )
  }

  it('shows the detected kind and the pattern that will be watched', () => {
    renderConfirm({ text: 'https://cracked-forum.example.net/threads/88213' })
    expect(screen.getByTestId('note-selection-kind').textContent).toBe('domain')
    expect(screen.getByTestId('note-selection-value').textContent).toBe(
      'cracked-forum.example.net'
    )
    expect(screen.getByText(/Path stripped/)).toBeTruthy()
  })

  it('renders Backfill checked and disabled, and states the bound it runs to', () => {
    // selectorLifecycle backfills every new selector unconditionally, so an
    // unticked box would describe behaviour the app does not have (R17) — but
    // it stops at RETRO_MAX_CAPTURES, and copy that implied otherwise would let
    // an empty match list read as evidence about captures below the cut.
    renderConfirm()
    const backfill = screen.getByTestId('note-selection-backfill') as HTMLInputElement
    expect(backfill.checked).toBe(true)
    expect(backfill.disabled).toBe(true)
    expect(
      screen.getByText(`Backfill — always runs, over the ${RETRO_MAX_CAPTURES} most recent captures`)
    ).toBeTruthy()
  })

  it('lets Watch be turned off', () => {
    const onToggleWatch = vi.fn()
    renderConfirm({ onToggleWatch })
    const watch = screen.getByTestId('note-selection-watch') as HTMLInputElement
    expect(watch.checked).toBe(true)
    expect(watch.disabled).toBe(false)
    fireEvent.click(watch)
    expect(onToggleWatch).toHaveBeenCalled()
  })

  it('shows the derived tag name and where it lands in tag mode', () => {
    renderConfirm({ mode: 'tag', text: 'Meridian Trust' })
    expect(screen.getByTestId('note-selection-value').textContent).toBe('meridian-trust')
    // Confirming writes the draft out (R15), so the copy has to say so — the
    // Cancel that follows no longer un-does it.
    expect(screen.getByText(/Applies to this note.*An unsaved note is saved first/s)).toBeTruthy()
    // Watch and Backfill are selector concepts; a tag has neither.
    expect(screen.queryByTestId('note-selection-watch')).toBeNull()
    expect(screen.queryByTestId('note-selection-backfill')).toBeNull()
  })

  it('labels a tag name as a tag, not with the kind of the raw selection', () => {
    // A hostname slugifies to a tag name that is no longer a domain, so the
    // selector kind beside it would describe something the value is not.
    renderConfirm({ mode: 'tag', text: 'meridian-trust.com' })
    expect(screen.getByTestId('note-selection-kind').textContent).toBe('tag')
    expect(screen.getByTestId('note-selection-value').textContent).toBe('meridian-trust-com')
  })

  it('cancels on Escape as well as on the button', () => {
    const onCancel = vi.fn()
    renderConfirm({ onCancel })
    const confirm = screen.getByTestId('note-selection-confirm')
    fireEvent.keyDown(confirm, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByTestId('note-selection-cancel'))
    expect(onCancel).toHaveBeenCalledTimes(2)
    // Escape belongs to this popover while it is up, including when the note
    // editor is the captures details panel's inline one. It says so by
    // attribute now that the capture guard no longer queries role="dialog"
    // (#686).
    expect(confirm.hasAttribute('data-selection-escape-guard')).toBe(true)
  })

  it('disables the confirm button while a write is in flight', () => {
    renderConfirm({ pending: true })
    expect((screen.getByTestId('note-selection-confirm-submit') as HTMLButtonElement).disabled).toBe(
      true
    )
  })
})

describe('NoteSelectionOverlay', () => {
  it('creates a selector with origin note through the ordinary create path', async () => {
    const create = vi.fn(async () => ({ id: 's1' }))
    fakeBridge({ selectors: { create } })
    const onDismiss = vi.fn()

    wrap(
      <NoteSelectionOverlay
        caseId="case1"
        resolveNoteId={async () => 'note1'}
        selection={confirmState()}
        onChoose={vi.fn()}
        onDismiss={onDismiss}
      />
    )
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(create).toHaveBeenCalledWith({
      caseId: 'case1',
      pattern: 'meridian-trust.com',
      isRegex: false,
      label: 'meridian-trust.com',
      origin: 'note',
      enabled: true
    })
    // Matches recompute through selectorLifecycle behind selectors:create; the
    // overlay writes no match rows itself.
    expect(notifySuccess).toHaveBeenCalledWith('Selector created — meridian-trust.com')
    await waitFor(() => expect(onDismiss).toHaveBeenCalled())
  })

  it('refreshes the selector lists the new selector belongs in', async () => {
    const create = vi.fn(async () => ({ id: 's1' }))
    fakeBridge({ selectors: { create } })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    render(
      <QueryClientProvider client={client}>
        <NoteSelectionOverlay
          caseId="case1"
          resolveNoteId={async () => 'note1'}
          selection={confirmState()}
          onChoose={vi.fn()}
          onDismiss={vi.fn()}
        />
      </QueryClientProvider>
    )
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() => expect(create).toHaveBeenCalled())
    // Nothing here owns the Signals screen, so without this the write is
    // invisible there for staleTime (30s) after the toast says it happened.
    const invalidated = () => invalidate.mock.calls.map(([arg]) => JSON.stringify(arg?.queryKey))
    await waitFor(() =>
      expect(invalidated()).toContain(JSON.stringify(queryKeys.selectors('case1')))
    )
    expect(invalidated()).toContain(JSON.stringify(queryKeys.selectorCaptureMatrix('case1')))
    expect(invalidated()).toContain(JSON.stringify(queryKeys.selectorCoverage('case1')))
  })

  it('passes an unticked Watch through as enabled: false', async () => {
    const created: Array<{ enabled?: boolean }> = []
    const create = vi.fn(async (params: { enabled?: boolean }) => {
      created.push(params)
      return { id: 's1' }
    })
    fakeBridge({ selectors: { create } })

    wrap(
      <NoteSelectionOverlay
        caseId="case1"
        resolveNoteId={async () => 'note1'}
        selection={confirmState()}
        onChoose={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('note-selection-watch'))
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() => expect(create).toHaveBeenCalled())
    expect(created[0]).toMatchObject({ enabled: false })
  })

  it('resolves the note first, then applies the tag by name', async () => {
    const order: string[] = []
    const applyToNote = vi.fn(async () => {
      order.push('apply')
      return { tag: { id: 't1', name: 'meridian-trust' }, captureId: 'cap1' }
    })
    fakeBridge({ tags: { applyToNote } })
    const resolveNoteId = vi.fn(async () => {
      order.push('resolve')
      return 'note1'
    })

    wrap(
      <NoteSelectionOverlay
        caseId="case1"
        resolveNoteId={resolveNoteId}
        selection={confirmState({ mode: 'tag', text: 'Meridian Trust' })}
        onChoose={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() => expect(applyToNote).toHaveBeenCalled())
    // A draft note has to exist before a tag can attach to it (R15).
    expect(order).toEqual(['resolve', 'apply'])
    expect(applyToNote).toHaveBeenCalledWith({ noteId: 'note1', name: 'meridian-trust' })
    expect(notifySuccess).toHaveBeenCalledWith(
      'Tag applied — meridian-trust, and to its capture'
    )
  })

  it('says so when the note was anchored to nothing', async () => {
    fakeBridge({
      tags: { applyToNote: vi.fn(async () => ({ tag: { id: 't1', name: 'note-only' } })) }
    })

    wrap(
      <NoteSelectionOverlay
        caseId="case1"
        resolveNoteId={async () => 'note1'}
        selection={confirmState({ mode: 'tag', text: 'note only' })}
        onChoose={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Tag applied — note-only'))
  })

  it('reports a failed write instead of closing as though it worked', async () => {
    const failure = new Error('nope')
    fakeBridge({
      selectors: {
        create: vi.fn(async () => {
          throw failure
        })
      }
    })
    const onDismiss = vi.fn()

    wrap(
      <NoteSelectionOverlay
        caseId="case1"
        resolveNoteId={async () => 'note1'}
        selection={confirmState()}
        onChoose={vi.fn()}
        onDismiss={onDismiss}
      />
    )
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("Couldn't create the selector", { cause: failure })
    )
    expect(onDismiss).not.toHaveBeenCalled()
  })

  it('reports a note that could not be resolved rather than tagging nothing', async () => {
    const failure = new Error('Write the note before tagging it')
    fakeBridge({ tags: { applyToNote: vi.fn() } })

    wrap(
      <NoteSelectionOverlay
        caseId="case1"
        resolveNoteId={async () => {
          throw failure
        }}
        selection={confirmState({ mode: 'tag' })}
        onChoose={vi.fn()}
        onDismiss={vi.fn()}
      />
    )
    fireEvent.click(screen.getByTestId('note-selection-confirm-submit'))

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith("Couldn't apply the tag", { cause: failure })
    )
  })

  it('shows the bar first and hands the chosen action back', () => {
    fakeBridge()
    const onChoose = vi.fn()

    wrap(
      <NoteSelectionOverlay
        caseId="case1"
        resolveNoteId={async () => 'note1'}
        selection={confirmState({ step: 'bar' })}
        onChoose={onChoose}
        onDismiss={vi.fn()}
      />
    )
    expect(screen.getByTestId('note-selection-bar')).toBeTruthy()
    expect(screen.queryByTestId('note-selection-confirm')).toBeNull()

    fireEvent.click(screen.getByTestId('note-selection-selector'))
    expect(onChoose).toHaveBeenCalledWith('selector')
  })
})
