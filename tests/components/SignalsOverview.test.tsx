// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, Selector, Tag } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { useAppStore } from '@renderer/stores/appStore'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case-1' }),
  useNavigate: () => vi.fn()
}))

// The rail has its own test file and drags in the Foreground Match Preview's
// data graph; the shell's job is composing the two cards and the selection.
vi.mock('@renderer/components/signals/SignalDetailRail', () => ({
  SignalDetailRail: ({ signal }: { signal: { id: string; name: string } | null }) => (
    <div data-testid="rail">{signal ? signal.name : 'empty'}</div>
  )
}))
// Likewise the advanced create card: it is the surviving CreateSelectorCard and
// keeps its own test.
vi.mock('@renderer/components/selectors/CreateSelectorCard', () => ({
  CreateSelectorCard: () => <div data-testid="create-selector-card" />
}))
vi.mock('@renderer/components/signals/AutoCaptureCard', () => ({
  AutoCaptureCard: () => <div data-testid="auto-capture-card" />
}))

import { SignalsOverview } from '@renderer/components/signals/SignalsOverview'

const selectors: Selector[] = [
  {
    id: 's1',
    caseId: 'case-1',
    pattern: 'acme',
    label: 'Acme mentions',
    isRegex: false,
    enabled: true,
    createdAt: '2026-08-01T00:00:00.000Z'
  },
  {
    id: 's2',
    caseId: 'case-1',
    pattern: 'bc1[a-z0-9]+',
    isRegex: true,
    enabled: false,
    createdAt: '2026-08-02T00:00:00.000Z'
  }
]

const tags: Tag[] = [{ id: 't1', name: 'evidence', color: '#22c55e' }]

const captures: Capture[] = [
  {
    id: 'c1',
    caseId: 'case-1',
    url: 'https://example.com/a',
    title: 'Page A',
    hash: 'h1',
    timestamp: '2026-01-01T00:00:00.000Z',
    format: 'mhtml',
    method: 'extension',
    createdAt: '2026-01-01T00:00:00.000Z'
  }
]

function install(overrides: Record<string, unknown> = {}) {
  return fakeBridge({
    selectors: {
      list: vi.fn(async () => selectors),
      matchCounts: vi.fn(async () => ({ s1: 4 })),
      captureMatrix: vi.fn(async () => ({ s1: ['c1'] })),
      create: vi.fn(async () => ({ ...selectors[0], id: 's3', pattern: 'new' })),
      update: vi.fn(async () => selectors[0]),
      delete: vi.fn(async () => true),
      exportMatches: vi.fn(async () => ({ exported: true })),
      ...(overrides.selectors as object)
    },
    tags: {
      list: vi.fn(async () => tags),
      usageCountsForCase: vi.fn(async () => ({ t1: 1 })),
      captureMatrix: vi.fn(async () => ({ t1: ['c1'] })),
      create: vi.fn(async () => tags[0]),
      update: vi.fn(async () => tags[0]),
      delete: vi.fn(async () => true),
      ...(overrides.tags as object)
    },
    captures: { list: vi.fn(async () => captures) }
  })
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<SignalsOverview />, { wrapper: Wrapper })
}

beforeEach(() => {
  install()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAppStore.getState().setSelectedSignalId(null)
})

describe('SignalsOverview', () => {
  it('shows selectors and tags on one screen', async () => {
    renderScreen()

    expect(await screen.findByTestId('signal-row-s1')).toBeTruthy()
    expect(screen.getByTestId('signal-row-s2')).toBeTruthy()
    expect(screen.getByTestId('signal-row-t1')).toBeTruthy()
    expect(screen.getByTestId('auto-capture-card')).toBeTruthy()
  })

  it('selects the first signal by default and follows a click', async () => {
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    await waitFor(() => expect(screen.getByTestId('rail').textContent).toBe('Acme mentions'))

    fireEvent.click(screen.getByTestId('signal-row-t1'))
    expect(screen.getByTestId('rail').textContent).toBe('evidence')
  })

  it('opens on the signal a Mention chip named rather than the first row', async () => {
    // #716. The chip writes the store then navigates. Without the seed the
    // screen falls back to allSignals[0], which is 's1' here, so a chip naming
    // the tag would silently open the first selector instead.
    useAppStore.getState().setSelectedSignalId('t1')
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    await waitFor(() => expect(screen.getByTestId('rail').textContent).toBe('evidence'))
  })

  it('clears the hand-off so a later visit is not still holding it', async () => {
    // The field is a hand-off, not a stored selection. Leaving it set is the
    // mechanism behind #772 on the Notes screen, and this screen must not
    // inherit it: opening Signals from the sidebar afterwards should land on
    // the default row again.
    useAppStore.getState().setSelectedSignalId('t1')
    renderScreen()
    await waitFor(() => expect(screen.getByTestId('rail').textContent).toBe('evidence'))
    expect(useAppStore.getState().selectedSignalId).toBeNull()

    cleanup()
    renderScreen()
    await screen.findByTestId('signal-row-s1')
    await waitFor(() => expect(screen.getByTestId('rail').textContent).toBe('Acme mentions'))
  })

  it('shows the empty rail when the case has no signals at all', async () => {
    install({ selectors: { list: vi.fn(async () => []) }, tags: { list: vi.fn(async () => []) } })
    renderScreen()

    await waitFor(() => expect(screen.getByTestId('rail').textContent).toBe('empty'))
    expect(
      screen.getByText('No selectors yet — type a pattern above to add the first.')
    ).toBeTruthy()
    expect(screen.getByText('No tags yet — name one above to add the first.')).toBeTruthy()
  })

  it('adds a selector from the inline row, stamped as added by hand', async () => {
    const create = vi.fn(async () => ({ ...selectors[0], id: 's3', pattern: 'new' }))
    install({ selectors: { create } })
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    const input = screen.getByTestId('add-selector-input')
    fireEvent.change(input, { target: { value: 'new' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        caseId: 'case-1',
        pattern: 'new',
        isRegex: false,
        origin: 'manual'
      })
    )
  })

  it('adds a tag with the next palette colour', async () => {
    const create = vi.fn(async () => tags[0])
    install({ tags: { create } })
    renderScreen()
    await screen.findByTestId('signal-row-t1')

    const input = screen.getByTestId('add-tag-input')
    fireEvent.change(input, { target: { value: 'Bank Records' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    // One tag exists, so the new one takes palette[1].
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'bank-records', color: '#ef4444' })
    )
  })

  it('switches a selector off through the row toggle', async () => {
    const update = vi.fn(async () => selectors[0])
    install({ selectors: { update } })
    renderScreen()
    const row = await screen.findByTestId('signal-row-s1')

    fireEvent.click(within(row).getByRole('switch'))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 's1', enabled: false }))
  })

  it('flips a selector between exact text and regex', async () => {
    const update = vi.fn(async () => selectors[0])
    install({ selectors: { update } })
    renderScreen()
    const row = await screen.findByTestId('signal-row-s1')

    fireEvent.click(within(row).getByText('Aa'))

    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 's1', isRegex: true }))
  })

  // #957 AC6: a selector belongs to one case, so it keeps the unguarded
  // delete the tag rows lost. The dialog assertion is the pin — without it
  // this passes whether or not a confirm step leaked onto selectors.
  it('deletes a selector from its row with no confirmation', async () => {
    const removeSelector = vi.fn(async () => true)
    install({ selectors: { delete: removeSelector } })
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    fireEvent.click(screen.getByLabelText('Delete Acme mentions'))

    await waitFor(() => expect(removeSelector).toHaveBeenCalledWith('s1'))
    expect(screen.queryByTestId('delete-tag-dialog')).toBeNull()
  })

  it('deletes a selector from the keyboard with no confirmation', async () => {
    const removeSelector = vi.fn(async () => true)
    install({ selectors: { delete: removeSelector } })
    renderScreen()

    fireEvent.keyDown(await screen.findByTestId('signal-row-s1'), { key: 'Backspace' })

    await waitFor(() => expect(removeSelector).toHaveBeenCalledWith('s1'))
    expect(screen.queryByTestId('delete-tag-dialog')).toBeNull()
  })

  it('renames a selector by its pattern and a tag by its name', async () => {
    const update = vi.fn(async () => selectors[0])
    const updateTag = vi.fn(async () => tags[0])
    install({ selectors: { update }, tags: { update: updateTag } })
    renderScreen()
    const row = await screen.findByTestId('signal-row-s1')

    fireEvent.doubleClick(row)
    const patternInput = screen.getByLabelText('Edit selector pattern')
    // The edit starts from the pattern, not the label: the pattern is what
    // matches, so that is what a rename has to be able to change.
    expect((patternInput as HTMLInputElement).value).toBe('acme')
    fireEvent.change(patternInput, { target: { value: 'acme corp' } })
    fireEvent.keyDown(patternInput, { key: 'Enter' })

    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 's1', pattern: 'acme corp' }))

    fireEvent.doubleClick(screen.getByTestId('signal-row-t1'))
    const nameInput = screen.getByLabelText('Edit tag name')
    fireEvent.change(nameInput, { target: { value: 'exhibits' } })
    fireEvent.keyDown(nameInput, { key: 'Enter' })

    await waitFor(() => expect(updateTag).toHaveBeenCalledWith({ id: 't1', name: 'exhibits' }))
  })

  it('opens and closes the bulk import drawer', async () => {
    renderScreen()
    await screen.findByTestId('signal-row-s1')
    expect(screen.queryByTestId('bulk-add-modal')).toBeNull()

    fireEvent.click(screen.getByTestId('bulk-add-btn'))
    expect(screen.getByTestId('bulk-add-modal')).toBeTruthy()

    fireEvent.click(screen.getByTestId('bulk-add-btn'))
    expect(screen.queryByTestId('bulk-add-modal')).toBeNull()
  })

  it('exports every match in the case from the card header', async () => {
    const exportMatches = vi.fn(async () => ({ exported: true }))
    install({ selectors: { exportMatches } })
    renderScreen()
    await screen.findByTestId('signal-row-s1')
    // Disabled until the match counts land, so wait rather than click into a
    // no-op and then wait for a call that can never arrive.
    await waitFor(() =>
      expect(screen.getByTestId('export-matches-btn')).toHaveProperty('disabled', false)
    )

    fireEvent.click(screen.getByTestId('export-matches-btn'))

    // No selector id: this button is the case-wide export, unlike the rail's.
    await waitFor(() => expect(exportMatches).toHaveBeenCalledWith('case-1', undefined))
  })

  it('disables the case-wide export when nothing has matched', async () => {
    install({ selectors: { matchCounts: vi.fn(async () => ({})) } })
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    await waitFor(() =>
      expect(screen.getByTestId('export-matches-btn')).toHaveProperty('disabled', true)
    )
  })

  it('keeps the advanced create card reachable for labels and the match preview', async () => {
    renderScreen()

    expect(await screen.findByTestId('create-selector-card')).toBeTruthy()
  })
})

// #957. Tags are app-global, so deleting one drops its capture and note links
// in cases the operator is not looking at. Both ways into the delete are
// covered because they are one prop on the row and a regression could reroute
// either of them past the dialog.
describe('SignalsOverview tag delete confirmation', () => {
  async function openConfirm(
    via: 'button' | 'keyboard',
    key: 'Backspace' | 'Delete' = 'Backspace'
  ) {
    renderScreen()
    const row = await screen.findByTestId('signal-row-t1')
    if (via === 'button') fireEvent.click(screen.getByLabelText('Delete evidence'))
    else fireEvent.keyDown(row, { key })
    return screen.getByTestId('delete-tag-dialog')
  }

  it('asks before deleting from the row button, and deletes on confirm', async () => {
    const removeTag = vi.fn(async () => true)
    install({ tags: { delete: removeTag } })
    await openConfirm('button')

    expect(removeTag).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('delete-tag-confirm'))

    await waitFor(() => expect(removeTag).toHaveBeenCalledWith('t1'))
  })

  it('deletes nothing when the row button confirmation is cancelled', async () => {
    const removeTag = vi.fn(async () => true)
    install({ tags: { delete: removeTag } })
    await openConfirm('button')

    fireEvent.click(screen.getByTestId('delete-tag-cancel'))

    // The IPC call is the assertion, not the surviving row: the row is still
    // drawn from a cached list either way, so it would sit there for a beat
    // even if the delete had gone through.
    await waitFor(() => expect(screen.queryByTestId('delete-tag-dialog')).toBeNull())
    expect(removeTag).not.toHaveBeenCalled()
    expect(screen.getByTestId('signal-row-t1')).toBeTruthy()
  })

  it('asks before deleting from Backspace on a focused row, and deletes on confirm', async () => {
    const removeTag = vi.fn(async () => true)
    install({ tags: { delete: removeTag } })
    await openConfirm('keyboard', 'Backspace')

    expect(removeTag).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('delete-tag-confirm'))

    await waitFor(() => expect(removeTag).toHaveBeenCalledWith('t1'))
  })

  it('deletes nothing when the Delete-key confirmation is cancelled', async () => {
    const removeTag = vi.fn(async () => true)
    install({ tags: { delete: removeTag } })
    await openConfirm('keyboard', 'Delete')

    fireEvent.click(screen.getByTestId('delete-tag-cancel'))

    await waitFor(() => expect(screen.queryByTestId('delete-tag-dialog')).toBeNull())
    expect(removeTag).not.toHaveBeenCalled()
    expect(screen.getByTestId('signal-row-t1')).toBeTruthy()
  })

  it('names the tag the row asked about', async () => {
    await openConfirm('button')

    expect(screen.getByText(/Delete ‘evidence’\?/)).toBeTruthy()
  })
})

// #701 gave a tag row its own Merge into… item, so the dialog moved up here
// from the detail rail. One dialog, two routes into it.
describe('SignalsOverview row context menus', () => {
  const allTags: Tag[] = [
    { id: 't1', name: 'evidence', color: '#22c55e' },
    { id: 't2', name: 'finance', color: '#3b82f6' }
  ]

  it('opens the merge dialog for the right-clicked tag and reports the survivor', async () => {
    const merge = vi.fn(async () => ({ target: allTags[1], captureLinks: 1, noteLinks: 0 }))
    install({ tags: { list: vi.fn(async () => allTags), merge } })
    renderScreen()

    fireEvent.contextMenu(await screen.findByTestId('signal-row-t1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-tag-merge'))

    expect(await screen.findByTestId('merge-tag-dialog')).toBeTruthy()
    // t1 is the source, so only t2 is offered as a target.
    fireEvent.click(await screen.findByTestId('merge-target-t2'))
    fireEvent.click(screen.getByTestId('merge-tag-commit'))

    await waitFor(() => expect(merge).toHaveBeenCalledWith({ sourceId: 't1', targetId: 't2' }))
    // The rail follows the survivor rather than falling back to the first row.
    await waitFor(() => expect(screen.getByTestId('rail').textContent).toBe('finance'))
  })

  it('recolours a tag from the row menu, through the same mutation the rail uses', async () => {
    const updateTag = vi.fn(async () => allTags[0])
    install({ tags: { list: vi.fn(async () => allTags), update: updateTag } })
    renderScreen()

    fireEvent.contextMenu(await screen.findByTestId('signal-row-t1'))
    await screen.findByRole('menu')
    fireEvent.keyDown(screen.getByTestId('context-menu-item-tag-color'), { key: 'Enter' })
    fireEvent.click(await screen.findByText('Blue'))

    await waitFor(() => expect(updateTag).toHaveBeenCalledWith({ id: 't1', color: '#3b82f6' }))
  })

  it('filters the captures by a selector picked from its row menu', async () => {
    renderScreen()

    fireEvent.contextMenu(await screen.findByTestId('signal-row-s1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-selector-show-matches'))

    expect(useAppStore.getState().activeSelectorFilters).toContain('s1')
  })

  it('exports one selector’s matches from its row menu', async () => {
    const exportMatches = vi.fn(async () => ({ exported: true }))
    install({ selectors: { exportMatches } })
    renderScreen()

    fireEvent.contextMenu(await screen.findByTestId('signal-row-s1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-selector-export'))

    await waitFor(() => expect(exportMatches).toHaveBeenCalledWith('case-1', 's1'))
  })
})
