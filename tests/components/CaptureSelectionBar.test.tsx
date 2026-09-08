// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const notifySuccess = vi.hoisted(() => vi.fn())
const notifyWarn = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: notifyWarn, success: notifySuccess, info: vi.fn() }
}))

// The export flow has its own dialog test; here only the case-scoped handoff
// matters — that the bar opens it with this case's id and name.
const exportDialogProps = vi.hoisted(() => vi.fn())
vi.mock('@renderer/components/export/ExportDialog', () => ({
  ExportDialog: (props: { caseId: string; caseName: string }) => {
    exportDialogProps(props)
    return <div data-testid="export-dialog-stub" />
  }
}))

import { CaptureSelectionBar } from '@renderer/components/captures/CaptureSelectionBar'
import { fakeBridge } from '../renderer/fakeBridge'
import { stubMatchMedia } from './matchMediaStub'

const SELECTED = ['cap-1', 'cap-2']

let setFavoriteMany: ReturnType<typeof vi.fn>
let addToCaptures: ReturnType<typeof vi.fn>
let countsForCaptures: ReturnType<typeof vi.fn>
let enqueueCaptures: ReturnType<typeof vi.fn>
let listFavorites: ReturnType<typeof vi.fn>

function renderBar(props: Partial<Parameters<typeof CaptureSelectionBar>[0]> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(
    <CaptureSelectionBar
      caseId="case1"
      selectedIds={SELECTED}
      allSelected={false}
      onToggleSelectAll={vi.fn()}
      onClear={vi.fn()}
      onDeleteSelection={vi.fn()}
      {...props}
    />,
    { wrapper: Wrapper }
  )
}

beforeEach(() => {
  stubMatchMedia(false)
  setFavoriteMany = vi.fn(async () => ({ affected: 2 }))
  addToCaptures = vi.fn(async () => ({ affected: 2 }))
  countsForCaptures = vi.fn(async () => ({}))
  enqueueCaptures = vi.fn(async () => ({ accepted: 2, rejected: [] }))
  listFavorites = vi.fn(async () => [])
  fakeBridge({
    cases: { list: vi.fn(async () => [{ id: 'case1', name: 'Nightjar' }]) },
    captures: { listFavorites, setFavoriteMany },
    tags: {
      list: vi.fn(async () => [{ id: 'tag-1', name: 'phishing', color: '#f59e0b' }]),
      addToCaptures,
      countsForCaptures
    },
    recapture: { enqueueCaptures }
  })
})

afterEach(() => {
  cleanup()
  notifySuccess.mockReset()
  notifyWarn.mockReset()
  exportDialogProps.mockReset()
})

describe('CaptureSelectionBar', () => {
  it('shows the visible-selection count and a select-all checkbox', () => {
    renderBar()
    expect(screen.getByText('2 selected')).toBeDefined()
    expect(screen.getByTitle('Select all')).toBeDefined()
  })

  it('flips the select-all affordance when everything visible is selected', () => {
    const onToggleSelectAll = vi.fn()
    renderBar({ allSelected: true, onToggleSelectAll })
    const toggle = screen.getByTitle('Clear all')
    fireEvent.click(toggle)
    expect(onToggleSelectAll).toHaveBeenCalledOnce()
  })

  it('clears via the X button', () => {
    const onClear = vi.fn()
    renderBar({ onClear })
    fireEvent.click(screen.getByTitle('Clear selection (Esc)'))
    expect(onClear).toHaveBeenCalledOnce()
  })

  it('favorites the selection when not everything is already favorited', async () => {
    renderBar()
    fireEvent.click(screen.getByTitle('Favorite selection'))
    await waitFor(() => expect(setFavoriteMany).toHaveBeenCalledOnce())
    expect(setFavoriteMany).toHaveBeenCalledWith({
      caseId: 'case1',
      captureIds: SELECTED,
      favorite: true
    })
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Favorited 2 captures'))
  })

  it('unfavorites when the whole selection is already favorited', async () => {
    listFavorites.mockResolvedValue(SELECTED)
    renderBar()
    // Wait for the favorites query to land before acting on it.
    await waitFor(() => expect(listFavorites).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    fireEvent.click(screen.getByTitle('Favorite selection'))
    await waitFor(() => expect(setFavoriteMany).toHaveBeenCalledOnce())
    expect(setFavoriteMany).toHaveBeenCalledWith({
      caseId: 'case1',
      captureIds: SELECTED,
      favorite: false
    })
  })

  // The picker itself is covered by BatchTagPopover.test.tsx; here only the
  // handoff matters — that the bar opens it over this case and this selection.
  it('applies a tag picked in the batch popover to the whole selection', async () => {
    renderBar()
    fireEvent.click(screen.getByTitle('Tag selection'))
    fireEvent.click(await screen.findByText('phishing'))
    await waitFor(() => expect(addToCaptures).toHaveBeenCalledOnce())
    expect(addToCaptures).toHaveBeenCalledWith({
      caseId: 'case1',
      captureIds: SELECTED,
      tagId: 'tag-1'
    })
    // The popover stays open so a second tag is a second click, not a second
    // gesture, and on apply the row state replaces the toast the interim
    // picker fired. Removal still toasts — BatchTagPopover.test.tsx covers it.
    expect(screen.queryByTestId('batch-tag-popover')).not.toBeNull()
    expect(notifySuccess).not.toHaveBeenCalled()
  })

  it('closes the tag picker on an outside click or Escape, but not on its own clicks', async () => {
    renderBar()
    const tagButton = screen.getByTitle('Tag selection')

    fireEvent.click(tagButton)
    const picker = await screen.findByText('phishing')
    // A click inside the picker is not an outside click.
    fireEvent.mouseDown(picker)
    expect(screen.queryByText('phishing')).not.toBeNull()
    // Nor is a click on the button that opened it — that path is the toggle's.
    fireEvent.mouseDown(tagButton)
    expect(screen.queryByText('phishing')).not.toBeNull()

    fireEvent.mouseDown(document.body)
    await waitFor(() => expect(screen.queryByText('phishing')).toBeNull())

    fireEvent.click(tagButton)
    await screen.findByText('phishing')
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByText('phishing')).toBeNull())
    // Escape closed the picker only; clearing the selection is the list's job.
    expect(addToCaptures).not.toHaveBeenCalled()
  })

  it('offers to create one when the picker has no tags to show', async () => {
    fakeBridge({
      cases: { list: vi.fn(async () => [{ id: 'case1', name: 'Nightjar' }]) },
      captures: { listFavorites },
      tags: { list: vi.fn(async () => []), countsForCaptures },
      recapture: {}
    })
    renderBar()
    fireEvent.click(screen.getByTitle('Tag selection'))
    expect(await screen.findByText(/type a name to create one/)).toBeDefined()
  })

  it('queues a batch recapture and reports the accepted count', async () => {
    renderBar()
    fireEvent.click(screen.getByTitle('Recapture selection'))
    await waitFor(() => expect(enqueueCaptures).toHaveBeenCalledOnce())
    expect(enqueueCaptures).toHaveBeenCalledWith({ caseId: 'case1', captureIds: SELECTED })
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('Recapture queued — 2 captures'))
  })

  it('warns when the recapture queue rejected part of the selection', async () => {
    enqueueCaptures.mockResolvedValue({
      accepted: 1,
      rejected: [{ url: 'https://x.test', reason: 'ignored URL pattern' }]
    })
    renderBar()
    fireEvent.click(screen.getByTitle('Recapture selection'))
    await waitFor(() =>
      expect(notifyWarn).toHaveBeenCalledWith(
        'Recapture: 1 queued, 1 rejected (ignored URL pattern)'
      )
    )
  })

  it('hands the selection ids to the delete flow', () => {
    const onDeleteSelection = vi.fn()
    renderBar({ onDeleteSelection })
    fireEvent.click(screen.getByTitle('Delete selection'))
    expect(onDeleteSelection).toHaveBeenCalledWith(SELECTED)
  })

  it('opens the export dialog scoped to the selection (#399)', async () => {
    renderBar()
    fireEvent.click(screen.getByTitle('Export selection'))
    expect(await screen.findByTestId('export-dialog-stub')).toBeDefined()
    await waitFor(() =>
      expect(exportDialogProps).toHaveBeenCalledWith(
        expect.objectContaining({
          caseId: 'case1',
          caseName: 'Nightjar',
          selectedCaptureIds: SELECTED
        })
      )
    )
  })
})
