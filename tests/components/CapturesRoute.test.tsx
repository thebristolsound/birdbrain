// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture } from '@shared/types'

// Hoisted: the factories run while the route's import graph is still loading,
// which is before a plain top-level const would be initialised.
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case1' })
}))

// The route's own handler is what is under test; the capture list, viewer and
// note modal contribute nothing to it and each drag in their own data graph.
// The details panel and rail are each reduced to the one control that invokes
// the handler. Their labels differ because the route can mount both at once —
// the overlay panel renders *in addition to* the rail once forcedPanelOpen
// flips — and a shared label would turn a future default change into a
// "found multiple elements" failure rather than a failure about this handler.
// The list itself contributes nothing here; the batch-delete tests only need
// the callback seam the real list's selection bar invokes.
vi.mock('@renderer/components/captures/CaptureList', () => ({
  CaptureList: ({ onDeleteSelection }: { onDeleteSelection: (ids: string[]) => void }) => (
    <button onClick={() => onDeleteSelection(['cap1', 'cap2'])}>list: delete selection</button>
  )
}))
vi.mock('@renderer/components/captures/CaptureViewer', () => ({
  CaptureViewer: () => null
}))
vi.mock('@renderer/components/notes/AddNoteModal', () => ({
  AddNoteModal: () => null
}))
vi.mock('@renderer/components/captures/CaptureDetailsPanel', () => ({
  CaptureDetailsPanel: ({
    onOpenExternal,
    onCopyUrl,
    onDuplicate,
    onDelete
  }: {
    onOpenExternal: () => void
    onCopyUrl: () => void
    onDuplicate: () => void
    onDelete: () => void
  }) => (
    <>
      <button onClick={onOpenExternal}>panel: open externally</button>
      <button onClick={onCopyUrl}>panel: copy url</button>
      <button onClick={onDuplicate}>panel: duplicate</button>
      <button onClick={onDelete}>panel: delete</button>
    </>
  )
}))
vi.mock('@renderer/components/captures/CaptureDetailsRail', () => ({
  CaptureDetailsRail: ({
    onOpenExternal,
    onExpand
  }: {
    onOpenExternal: () => void
    onExpand: () => void
  }) => (
    <>
      <button onClick={onOpenExternal}>rail: open externally</button>
      <button onClick={onExpand}>rail: expand</button>
    </>
  )
}))

import { CapturesRoute } from '@renderer/routes/cases/$caseId/captures'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'
import { stubResizeObserver } from './resizeObserverStub'
import type { BatchDeleteResult } from '@shared/ipc'

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence',
  title: 'Example',
  hash: 'h',
  timestamp: '2026-08-01T12:00:00.000Z',
  createdAt: '2026-08-01T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
}

const duplicateOf: Capture = {
  ...capture,
  id: 'cap2',
  method: 'duplicate',
  duplicateOfCaptureId: 'cap1'
}

// jsdom's viewport is 1024px wide, under the route's 1100px collapse
// threshold, so the rail is the variant that mounts here.
const OPEN_CONTROL = 'rail: open externally'
// Delete lives only on the full details panel, and at this viewport the rail is
// what mounts — so the overlay panel has to be opened first.
const EXPAND_CONTROL = 'rail: expand'
const DELETE_CONTROL = 'panel: delete'
const COPY_URL_CONTROL = 'panel: copy url'
const DUPLICATE_CONTROL = 'panel: duplicate'

let openExternal: ReturnType<typeof vi.fn>
let deleteMany: ReturnType<typeof vi.fn>
let duplicate: ReturnType<typeof vi.fn>
let writeText: ReturnType<typeof vi.fn>
// Held so the assertion can be on identity: the handler must pass the original
// rejection through as `cause`, not a rewrapped stand-in.
let cause: Error

const BATCH_CONTROL = 'list: delete selection'

function cleanDeleteResult(ids: string[]): BatchDeleteResult {
  return {
    outcomes: ids.map((captureId) => ({ captureId, status: 'deleted' as const })),
    deletedIds: ids,
    failedIds: [],
    manifest: { baseIndex: 4, committedEntries: ids.length }
  }
}

// Renders, opens the batch confirm dialog and presses through it, returning
// the result dialog. Every batch test starts here, so the sequence lives in
// one place.
async function runBatchDelete() {
  renderRoute()
  fireEvent.click(await screen.findByText(BATCH_CONTROL))
  const confirm = await screen.findByTestId('batch-delete-confirm')
  fireEvent.click(within(confirm).getByText('Delete 2 captures'))
  return screen.findByTestId('batch-delete-result')
}

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<CapturesRoute />, { wrapper: Wrapper })
}

const NARROW_WIDTH = window.innerWidth

// jsdom is 1024px wide, under the 1100px threshold, so the details column is
// forced to its rail. Widening first is the only way to reach the docked panel.
function renderRouteWide() {
  window.innerWidth = 1400
  return renderRoute()
}

beforeEach(() => {
  stubMatchMedia(false)
  stubResizeObserver()
  localStorage.clear()
  cause = new Error('EACCES')
  openExternal = vi.fn(async () => {
    throw cause
  })
  deleteMany = vi.fn(async () => cleanDeleteResult(['cap1', 'cap2']))
  duplicate = vi.fn(async () => ({ status: 'duplicated' as const, capture: duplicateOf }))
  writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  fakeBridge({
    captures: { list: vi.fn(async () => [capture]), openExternal, deleteMany, duplicate },
    settings: { get: vi.fn(async () => ({ detailsPanelCollapsed: false })) }
  })
  useAppStore.getState().setSelectedCaptureId(capture.id)
})

afterEach(() => {
  cleanup()
  window.innerWidth = NARROW_WIDTH
  notifyError.mockReset()
  useAppStore.getState().setSelectedCaptureId(null)
  useAppStore.getState().setActiveViewerTab('screenshot')
  useAppStore.getState().clearCaptureSelection()
})

describe('CapturesRoute', () => {
  it("reports a failed shell launch when the capture's URL cannot be opened", async () => {
    renderRoute()

    fireEvent.click(await screen.findByText(OPEN_CONTROL))

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    expect(openExternal).toHaveBeenCalledWith('https://example.com/evidence')
    const [message, opts] = notifyError.mock.calls[0]
    // Exact match, not a substring: the capture URL is the evidence trail, and
    // a fixed literal with nothing interpolated into it is what keeps it out of
    // the durable log. A message that grew the URL would fail here.
    expect(message).toBe("Couldn't open the link in your browser")
    expect(opts.cause).toBe(cause)
  })

  it('says nothing when the capture URL opens successfully', async () => {
    openExternal.mockResolvedValue(undefined)
    renderRoute()

    fireEvent.click(await screen.findByText(OPEN_CONTROL))

    await waitFor(() => expect(openExternal).toHaveBeenCalledOnce())
    expect(notifyError).not.toHaveBeenCalled()
  })

  // #825. Copy URL is one capability reached two ways, and the route is what
  // binds both to the capture the operator is looking at.
  describe('copy URL', () => {
    it("copies the selected capture's URL from the actions menu", async () => {
      renderRouteWide()

      fireEvent.click(await screen.findByText(COPY_URL_CONTROL))

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.com/evidence'))
    })

    // The accelerator is mounted on the route rather than on the panel
    // precisely so it survives this layout: jsdom is 1024px wide, so the
    // details column is its 40px rail and the menu item is not on screen.
    it('copies it on ctrl+C even with the details panel collapsed to its rail', async () => {
      renderRoute()
      await screen.findByText(OPEN_CONTROL)
      expect(screen.queryByText(COPY_URL_CONTROL)).toBeNull()

      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
      )

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://example.com/evidence'))
    })

    it('copies nothing when no capture is selected', async () => {
      useAppStore.getState().setSelectedCaptureId(null)
      renderRoute()

      document.body.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
      )

      await waitFor(() => expect(screen.getByText(BATCH_CONTROL)).toBeDefined())
      expect(writeText).not.toHaveBeenCalled()
    })
  })

  // #827. The route owns the mutation for the same reason it owns the copy-URL
  // accelerator: the panel is rendered from two call sites and is absent
  // whenever the details column is a rail.
  describe('duplicate', () => {
    it('duplicates the selected capture from the actions menu', async () => {
      renderRouteWide()

      fireEvent.click(await screen.findByText(DUPLICATE_CONTROL))

      await waitFor(() => expect(duplicate).toHaveBeenCalledWith('cap1'))
      expect(duplicate).toHaveBeenCalledOnce()
    })

    it('duplicates nothing when no capture is selected', async () => {
      useAppStore.getState().setSelectedCaptureId(null)
      renderRouteWide()

      await waitFor(() => expect(screen.queryByText(DUPLICATE_CONTROL)).toBeNull())
      expect(duplicate).not.toHaveBeenCalled()
    })
  })

  // #582. The old copy said deletion "will permanently remove the capture and its
  // files", which an operator reads as redaction. It is not: the append-only
  // manifest keeps the URL, and every audit-trail export ships it. The disclosure
  // has to be at the point of decision, so assert on the dialog rather than a doc.
  it('discloses that deleting a capture does not redact it from the manifest', async () => {
    renderRoute()

    fireEvent.click(await screen.findByText(EXPAND_CONTROL))
    fireEvent.click(await screen.findByText(DELETE_CONTROL))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Deleting is not redacting.')).toBeDefined()
    expect(
      within(dialog).getByText(/URL, capture time and hashes stay in it permanently/)
    ).toBeDefined()
    expect(
      within(dialog).getByText(/ship in every export that includes the audit trail/)
    ).toBeDefined()
  })

  // #396. The bar hands its ids up to the route, which owns both dialogs so
  // they outlive the bar once the selection empties.
  describe('batch delete', () => {
    it('confirms the count and repeats the manifest disclosure before deleting', async () => {
      renderRoute()

      fireEvent.click(await screen.findByText(BATCH_CONTROL))

      const confirm = await screen.findByTestId('batch-delete-confirm')
      expect(within(confirm).getByText('Delete 2 captures?')).toBeDefined()
      expect(within(confirm).getByText('Deleting is not redacting.')).toBeDefined()
      // Nothing is written until the operator confirms.
      expect(deleteMany).not.toHaveBeenCalled()

      fireEvent.click(within(confirm).getByText('Cancel'))
      await waitFor(() => expect(screen.queryByTestId('batch-delete-confirm')).toBeNull())
      expect(deleteMany).not.toHaveBeenCalled()
    })

    it('reports a clean batch as deleted N of N with the committed entry count', async () => {
      const result = await runBatchDelete()

      expect(deleteMany).toHaveBeenCalledWith({ caseId: 'case1', captureIds: ['cap1', 'cap2'] })
      expect(within(result).getByText('Deleted 2 of 2')).toBeDefined()
      expect(
        within(result).getByText(/All selected captures were removed from this machine/)
      ).toBeDefined()
      expect(within(result).getByText(/2 deletion entries were appended/)).toBeDefined()
      // Nothing failed, so there is nothing to retry.
      expect(within(result).queryByText(/Retry/)).toBeNull()
    })

    // Prefix-commit: the mutation resolves even when part of the batch failed,
    // so the dialog has to key off the outcomes rather than an error.
    it('spells out the rolled-back, unattempted and rejected parts of a partial batch', async () => {
      deleteMany.mockResolvedValue({
        outcomes: [
          { captureId: 'cap1', status: 'deleted' },
          { captureId: 'cap2', status: 'rolled_back', stage: 'db', error: 'SqliteError' },
          { captureId: 'cap3', status: 'not_attempted' },
          { captureId: 'cap4', status: 'rejected', reason: 'not_found' },
          { captureId: 'cap5', status: 'rejected', reason: 'duplicate' }
        ],
        deletedIds: ['cap1'],
        failedIds: ['cap2', 'cap3'],
        haltedAt: 'cap2',
        manifest: { baseIndex: 4, committedEntries: 1 }
      } satisfies BatchDeleteResult)

      const result = await runBatchDelete()

      expect(within(result).getByText('Deleted 1 of 2')).toBeDefined()
      expect(within(result).getByText(/1 deletion entry was appended/)).toBeDefined()
      expect(
        within(result).getByText(/its files were removed but its database record remains/)
      ).toBeDefined()
      expect(within(result).getByText(/SqliteError/)).toBeDefined()
      expect(within(result).getByText(/1 capture was not attempted/)).toBeDefined()
      expect(within(result).getByText(/1 was already gone/)).toBeDefined()
      expect(within(result).getByText(/1 duplicate id was ignored/)).toBeDefined()
      // The clean line must not appear alongside the failures.
      expect(within(result).queryByText(/All selected captures were removed/)).toBeNull()
    })

    it('names the artifact stage when the files themselves could not be removed', async () => {
      deleteMany.mockResolvedValue({
        outcomes: [
          { captureId: 'cap1', status: 'rolled_back', stage: 'artifacts', error: 'EACCES' },
          { captureId: 'cap2', status: 'not_attempted' }
        ],
        deletedIds: [],
        failedIds: ['cap1', 'cap2'],
        haltedAt: 'cap1',
        manifest: { baseIndex: 4, committedEntries: 0 }
      } satisfies BatchDeleteResult)

      const result = await runBatchDelete()

      expect(within(result).getByText('Deleted 0 of 2')).toBeDefined()
      expect(
        within(result).getByText(/its files could not be removed, so it is intact/)
      ).toBeDefined()
      // committedEntries is 0, so the manifest sentence is suppressed entirely.
      expect(within(result).queryByText(/appended/)).toBeNull()
    })

    it('retries only the failed ids, never the rejected ones', async () => {
      deleteMany.mockResolvedValueOnce({
        outcomes: [
          { captureId: 'cap1', status: 'rolled_back', stage: 'db', error: 'SqliteError' },
          { captureId: 'cap2', status: 'rejected', reason: 'not_found' }
        ],
        deletedIds: [],
        failedIds: ['cap1'],
        haltedAt: 'cap1',
        manifest: { baseIndex: 4, committedEntries: 0 }
      } satisfies BatchDeleteResult)
      deleteMany.mockResolvedValueOnce(cleanDeleteResult(['cap1']))

      const result = await runBatchDelete()
      fireEvent.click(within(result).getByText('Retry 1 failed'))

      await waitFor(() => expect(deleteMany).toHaveBeenCalledTimes(2))
      expect(deleteMany).toHaveBeenLastCalledWith({ caseId: 'case1', captureIds: ['cap1'] })
      expect(await screen.findByText('Deleted 1 of 1')).toBeDefined()
    })

    it('drops deleted rows from the selection and moves the detail off a deleted capture', async () => {
      useAppStore.getState().selectAllCaptures(['cap1', 'cap2', 'cap3'])
      renderRoute()

      fireEvent.click(await screen.findByText(BATCH_CONTROL))
      const confirm = await screen.findByTestId('batch-delete-confirm')
      fireEvent.click(within(confirm).getByText('Delete 2 captures'))

      await screen.findByTestId('batch-delete-result')
      expect([...useAppStore.getState().selectedCaptureIds]).toEqual(['cap3'])
      // cap1 was the detail selection and the case has nothing left to fall
      // back to (the captures query returns cap1 alone).
      expect(useAppStore.getState().selectedCaptureId).toBeNull()
    })

    it('keeps the confirm dialog up when the whole call is rejected', async () => {
      deleteMany.mockRejectedValue(new Error('BATCH_CROSS_CASE'))
      renderRoute()

      fireEvent.click(await screen.findByText(BATCH_CONTROL))
      const confirm = await screen.findByTestId('batch-delete-confirm')
      fireEvent.click(within(confirm).getByText('Delete 2 captures'))

      await waitFor(() => expect(deleteMany).toHaveBeenCalledOnce())
      expect(screen.queryByTestId('batch-delete-result')).toBeNull()
      expect(screen.getByTestId('batch-delete-confirm')).toBeDefined()
    })
  })

  // #397. Which of the three columns render, and in which form, is the whole
  // point of the layout rework — so assert the branches rather than the pixels.
  describe('column layout', () => {
    it('docks the details panel on a wide viewport', async () => {
      renderRouteWide()

      expect(await screen.findByTestId('capture-details-aside')).toBeDefined()
      expect(screen.getByText(DELETE_CONTROL)).toBeDefined()
      expect(screen.getByText(BATCH_CONTROL)).toBeDefined()
    })

    it('swaps the list for its rail when the list is collapsed', async () => {
      localStorage.setItem('captureListCollapsed', 'true')
      renderRouteWide()

      expect(await screen.findByTestId('capture-list-rail')).toBeDefined()
      expect(screen.queryByText(BATCH_CONTROL)).toBeNull()
    })

    it('restores the list when the rail is expanded', async () => {
      localStorage.setItem('captureListCollapsed', 'true')
      renderRouteWide()

      fireEvent.click(await screen.findByTestId('capture-list-rail-expand'))

      expect(await screen.findByText(BATCH_CONTROL)).toBeDefined()
      expect(screen.queryByTestId('capture-list-rail')).toBeNull()
      expect(localStorage.getItem('captureListCollapsed')).toBe('false')
    })

    it('steps through captures from the collapsed list rail', async () => {
      const second: Capture = { ...capture, id: 'cap2', url: 'https://example.com/second' }
      fakeBridge({
        captures: { list: vi.fn(async () => [capture, second]), openExternal, deleteMany },
        settings: { get: vi.fn(async () => ({ detailsPanelCollapsed: false })) }
      })
      localStorage.setItem('captureListCollapsed', 'true')
      renderRouteWide()

      const next = await screen.findByTitle('Next capture')
      await waitFor(() => expect((next as HTMLButtonElement).disabled).toBe(false))

      fireEvent.click(next)
      expect(useAppStore.getState().selectedCaptureId).toBe('cap2')

      fireEvent.click(screen.getByTitle('Previous capture'))
      expect(useAppStore.getState().selectedCaptureId).toBe('cap1')
    })

    it('gives the Wayback tab the full width, hiding both side columns', async () => {
      renderRouteWide()
      await screen.findByTestId('capture-details-aside')

      act(() => useAppStore.getState().setActiveViewerTab('wayback'))

      expect(screen.queryByTestId('capture-details-aside')).toBeNull()
      expect(screen.queryByText(BATCH_CONTROL)).toBeNull()
      // Not even the rail: the list disappears outright on this tab.
      expect(screen.queryByTestId('capture-list-rail')).toBeNull()
    })

    it('keeps a collapsed details rail reachable on the Wayback tab', async () => {
      renderRoute()
      await screen.findByText(OPEN_CONTROL)

      act(() => useAppStore.getState().setActiveViewerTab('wayback'))

      expect(screen.getByTestId('capture-details-aside').className).toContain('w-10')
      expect(screen.getByText(OPEN_CONTROL)).toBeDefined()
    })

    it('keeps the forced-collapse overlay reaching the route handlers', async () => {
      renderRoute()

      fireEvent.click(await screen.findByText(EXPAND_CONTROL))

      expect(screen.getByText(DELETE_CONTROL)).toBeDefined()
      expect(screen.getByTestId('capture-details-overlay')).toBeDefined()
      // The 40px rail stays mounted beside the overlay rather than being
      // replaced by it — its expand button is the only way back to the details
      // once the overlay is closed. This is what makes `detailsOverlay` a
      // separate output rather than a fourth `details` state, so assert it:
      // folding the two together would strand the operator under 1100px.
      expect(screen.getByTestId('capture-details-aside').className).toContain('w-10')
      expect(screen.getByText(OPEN_CONTROL)).toBeDefined()
      expect(screen.getByText(EXPAND_CONTROL)).toBeDefined()
    })

    // The overlay is opaque and 400px wide, so leaving it up on the full-bleed
    // Wayback tab hides the snapshot list and its pin controls behind it.
    it('drops the forced-collapse overlay when the Wayback tab takes the full width', async () => {
      renderRoute()

      fireEvent.click(await screen.findByText(EXPAND_CONTROL))
      expect(screen.getByTestId('capture-details-overlay')).toBeDefined()

      act(() => useAppStore.getState().setActiveViewerTab('wayback'))

      expect(screen.queryByTestId('capture-details-overlay')).toBeNull()
      // The rail it was expanded from is still there to re-open it with.
      expect(screen.getByTestId('capture-details-aside').className).toContain('w-10')
    })
  })
})
