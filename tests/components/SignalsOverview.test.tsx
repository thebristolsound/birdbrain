// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Capture, Selector, Tag } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { useAppStore } from '@renderer/stores/appStore'

// One spy for the whole file, so a test can assert where a menu action sent
// the operator rather than only what it wrote to the store.
const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case-1' }),
  useNavigate: () => navigate
}))

const notifyError = vi.hoisted(() => vi.fn())
const notifyInfo = vi.hoisted(() => vi.fn())
const notifySuccess = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/notify', () => ({
  notify: { success: notifySuccess, error: notifyError, warn: vi.fn(), info: notifyInfo }
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

vi.mock('@renderer/components/export/ExportDialog', () => ({
  ExportDialog: ({
    selectedCaptureIds,
    onClose
  }: {
    selectedCaptureIds?: string[]
    onClose: () => void
  }) => (
    <div data-testid="tag-export-dialog">
      {selectedCaptureIds?.join(',')}
      <button onClick={onClose}>Close scoped export</button>
    </div>
  )
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
    cases: { get: vi.fn(async () => ({ id: 'case-1', name: 'Case One' })) },
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
      capturesWithAnyTag: vi.fn(async () => ['c1']),
      create: vi.fn(async () => tags[0]),
      update: vi.fn(async () => tags[0]),
      delete: vi.fn(async () => true),
      ...(overrides.tags as object)
    },
    captures: { list: vi.fn(async () => captures), ...(overrides.captures as object) }
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
  navigate.mockReset()
  notifyError.mockReset()
  notifyInfo.mockReset()
  notifySuccess.mockReset()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAppStore.getState().setSelectedSignalId(null)
  useAppStore.getState().clearSelectorFilters()
  useAppStore.getState().clearTagFilters()
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

  // #1754: switching regex on for text that does not compile as a regex would
  // save a selector that matches nothing.
  it('refuses to switch regex on for a pattern that does not compile', async () => {
    const update = vi.fn(async () => selectors[0])
    install({
      selectors: { update, list: vi.fn(async () => [{ ...selectors[0], pattern: 'a(b' }]) }
    })
    renderScreen()
    const row = await screen.findByTestId('signal-row-s1')

    fireEvent.click(within(row).getByText('Aa'))

    expect(update).not.toHaveBeenCalled()
    expect(String(notifyInfo.mock.calls[0][0])).toMatch(/^‘a\(b’ is not a valid regular expression/)
  })

  it('refuses to rename a regex selector to a pattern that does not compile', async () => {
    const update = vi.fn(async () => selectors[1])
    install({ selectors: { update } })
    renderScreen()
    await screen.findByTestId('signal-row-s2')

    fireEvent.doubleClick(screen.getByTestId('signal-row-s2'))
    const input = screen.getByLabelText('Edit selector pattern')
    fireEvent.change(input, { target: { value: 'bc1[' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(update).not.toHaveBeenCalled()
    expect(String(notifyInfo.mock.calls[0][0])).toMatch(/is not a valid regular expression/)
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
describe('SignalsOverview empty lists (#1537)', () => {
  it('names neither list a grid while it is empty', async () => {
    install({ selectors: { list: vi.fn(async () => []) }, tags: { list: vi.fn(async () => []) } })
    renderScreen()
    const tagList = await screen.findByTestId('signals-tag-list')

    expect(screen.queryByRole('grid')).toBeNull()
    expect(tagList.hasAttribute('aria-label')).toBe(false)
    expect(document.querySelector('[aria-label="Selectors"]')).toBeNull()
  })
})

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

  // The dialog is mounted only while a delete is pending, so it is unmounted
  // rather than closed; focus still has to come back to the row (#1536).
  it('hands focus back to the row when Escape dismisses the Delete-key confirmation', async () => {
    renderScreen()
    const row = await screen.findByTestId('signal-row-t1')
    row.focus()
    fireEvent.keyDown(row, { key: 'Backspace' })
    expect(screen.getByTestId('delete-tag-dialog').contains(document.activeElement)).toBe(true)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByTestId('delete-tag-dialog')).toBeNull()
    expect(document.activeElement).toBe(row)
  })

  it('gives each grid one Tab stop that follows focus', async () => {
    renderScreen()
    await screen.findByTestId('signal-row-t1')
    // The selector list, because it has two rows: one row cannot tell a
    // roving stop from every row being a stop.
    const list = within(screen.getByRole('grid', { name: 'Selectors' }))
    const rows = await list.findAllByRole('row')
    expect(rows.length).toBe(2)
    const [first, last] = rows
    expect(rows.filter((row) => row.tabIndex === 0)).toEqual([first])
    last.focus()
    await waitFor(() => expect(last.tabIndex).toBe(0))
    expect(rows.filter((row) => row.tabIndex === 0)).toEqual([last])
  })

  it('hands focus back to the row button when the confirmation is cancelled', async () => {
    renderScreen()
    await screen.findByTestId('signal-row-t1')
    const button = screen.getByLabelText('Delete evidence')
    button.focus()
    fireEvent.click(button)

    fireEvent.click(screen.getByTestId('delete-tag-cancel'))

    expect(document.activeElement).toBe(button)
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

  // Both halves matter to the operator: the filter alone leaves them on
  // Signals looking at nothing, and the navigation alone lands them on an
  // unfiltered list.
  it('filters the captures by a selector picked from its row menu, and goes there', async () => {
    renderScreen()

    fireEvent.contextMenu(await screen.findByTestId('signal-row-s1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-selector-show-matches'))

    expect(useAppStore.getState().activeSelectorFilters).toContain('s1')
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-1' }
    })
  })

  // The tag half of the same contract (#918). It writes the tag slot, not the
  // selector one, so the two narrowings compose instead of overwriting.
  it('filters the captures by a tag picked from its row menu, and goes there', async () => {
    renderScreen()

    fireEvent.contextMenu(await screen.findByTestId('signal-row-t1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-tag-filter-captures'))

    expect(useAppStore.getState().activeTagFilters).toContain('t1')
    expect(useAppStore.getState().activeSelectorFilters).not.toContain('t1')
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case-1' }
    })
  })

  it('exports one selector’s matches from its row menu', async () => {
    const exportMatches = vi.fn(async () => ({ exported: true }))
    install({ selectors: { exportMatches } })
    renderScreen()

    fireEvent.contextMenu(await screen.findByTestId('signal-row-s1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-selector-export'))

    await waitFor(() => expect(exportMatches).toHaveBeenCalledWith('case-1', 's1'))
    expect(notifyError).not.toHaveBeenCalled()
  })

  // The export is not a mutation, so the mutation cache's onError never sees
  // it: without the toast a failed write looks exactly like a successful one.
  it('tells the operator when a selector’s export fails', async () => {
    const exportMatches = vi.fn(async () => {
      throw new Error('no disk')
    })
    install({ selectors: { exportMatches } })
    renderScreen()

    fireEvent.contextMenu(await screen.findByTestId('signal-row-s1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-selector-export'))

    await waitFor(() => expect(notifyError).toHaveBeenCalled())
    expect(String(notifyError.mock.calls[0][0])).toContain('export')
  })
})

// #1549. A selector's delete cascades its persisted matches, with no trash to
// restore them, so all three routes into it stop at a dialog naming the
// selector — the tag rows' shape (#957). This replaces #957 AC6, which pinned
// the unguarded selector delete this ticket removes.
describe('SignalsOverview selector delete confirmation', () => {
  async function openConfirm(via: 'button' | 'keyboard' | 'menu') {
    renderScreen()
    const row = await screen.findByTestId('signal-row-s1')
    // The match count lands in its own query; wait so the dialog copy has it.
    await waitFor(() => expect(within(row).getByTestId('signal-count').textContent).toBe('4'))
    if (via === 'button') fireEvent.click(screen.getByLabelText('Delete Acme mentions'))
    else if (via === 'keyboard') fireEvent.keyDown(row, { key: 'Backspace' })
    else {
      fireEvent.contextMenu(row)
      await screen.findByRole('menu')
      fireEvent.click(screen.getByTestId('context-menu-item-selector-delete'))
    }
    return screen.findByTestId('delete-selector-dialog')
  }

  it.each(['button', 'keyboard', 'menu'] as const)(
    'asks before deleting from the %s route, and deletes on confirm',
    async (via) => {
      const removeSelector = vi.fn(async () => true)
      install({ selectors: { delete: removeSelector } })
      await openConfirm(via)

      expect(removeSelector).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('delete-selector-confirm'))

      await waitFor(() => expect(removeSelector).toHaveBeenCalledWith('s1'))
      await waitFor(() => expect(screen.queryByTestId('delete-selector-dialog')).toBeNull())
    }
  )

  it('deletes nothing when the confirmation is cancelled', async () => {
    const removeSelector = vi.fn(async () => true)
    install({ selectors: { delete: removeSelector } })
    await openConfirm('keyboard')

    fireEvent.click(screen.getByTestId('delete-selector-cancel'))

    await waitFor(() => expect(screen.queryByTestId('delete-selector-dialog')).toBeNull())
    expect(removeSelector).not.toHaveBeenCalled()
  })

  it('names the selector and the matches that go with it', async () => {
    const dialog = await openConfirm('button')

    expect(within(dialog).getByText(/Delete ‘Acme mentions’\?/)).toBeTruthy()
    expect(dialog.textContent).toContain('Its matches on 4 captures in this case are deleted')
    expect(dialog.textContent).toContain('The captures themselves are not deleted')
  })

  it('says so when the selector has matched nothing', async () => {
    renderScreen()
    fireEvent.click(await screen.findByLabelText('Delete bc1[a-z0-9]+'))

    const dialog = await screen.findByTestId('delete-selector-dialog')
    expect(dialog.textContent).toContain('It has not matched any captures yet.')
  })

  it('keeps the dialog open when the delete fails', async () => {
    const removeSelector = vi.fn(async () => {
      throw new Error('locked')
    })
    install({ selectors: { delete: removeSelector } })
    await openConfirm('button')

    fireEvent.click(screen.getByTestId('delete-selector-confirm'))

    await waitFor(() => expect(removeSelector).toHaveBeenCalled())
    expect(screen.getByTestId('delete-selector-dialog')).toBeTruthy()
  })
})

// #1549: the inline add row refuses what bulk import refuses, and a taken tag
// name is reported as taken rather than as a failure to report.
describe('SignalsOverview duplicates', () => {
  it('refuses a selector the case already holds, case-insensitively, and selects it', async () => {
    const create = vi.fn(async () => selectors[0])
    install({ selectors: { create } })
    renderScreen()
    await screen.findByTestId('signal-row-s1')
    fireEvent.click(screen.getByTestId('signal-row-t1'))

    const input = screen.getByTestId('add-selector-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ACME' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(create).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('‘ACME’ is already a selector in this case')
    expect(screen.getByTestId('rail').textContent).toBe('Acme mentions')
    expect(input.value).toBe('ACME')
  })

  it('compares a regex exactly and only against other regexes', async () => {
    const create = vi.fn(async () => ({ ...selectors[1], id: 's3' }))
    install({ selectors: { create } })
    renderScreen()
    await screen.findByTestId('signal-row-s2')
    const input = screen.getByTestId('add-selector-input')

    fireEvent.change(input, { target: { value: '/bc1[a-z0-9]+/' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(create).not.toHaveBeenCalled()
    expect(screen.getByTestId('rail').textContent).toBe('bc1[a-z0-9]+')

    // The same text as exact text is a different selector.
    fireEvent.change(input, { target: { value: 'bc1[a-z0-9]+' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        caseId: 'case-1',
        pattern: 'bc1[a-z0-9]+',
        isRegex: false,
        origin: 'manual'
      })
    )
  })

  it('lets an edit through when no other selector holds the pattern', async () => {
    const update = vi.fn(async () => selectors[0])
    install({ selectors: { update } })
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    fireEvent.doubleClick(screen.getByTestId('signal-row-s2'))
    const input = screen.getByLabelText('Edit selector pattern')
    fireEvent.change(input, { target: { value: 'bc1[a-z0-9]+x' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 's2', pattern: 'bc1[a-z0-9]+x' }))
    update.mockClear()

    fireEvent.doubleClick(screen.getByTestId('signal-row-s1'))
    const again = screen.getByLabelText('Edit selector pattern')
    fireEvent.change(again, { target: { value: 'ACME' } })
    fireEvent.keyDown(again, { key: 'Enter' })
    // Its own pattern in different letter case is an edit, not a duplicate.
    await waitFor(() => expect(update).toHaveBeenCalledWith({ id: 's1', pattern: 'ACME' }))
  })

  it('refuses an edit onto a pattern another selector holds', async () => {
    const update = vi.fn(async () => selectors[0])
    install({
      selectors: {
        update,
        list: vi.fn(async () => [
          selectors[0],
          { ...selectors[1], isRegex: false, pattern: 'beta' }
        ])
      }
    })
    renderScreen()
    await screen.findByTestId('signal-row-s2')

    fireEvent.doubleClick(screen.getByTestId('signal-row-s2'))
    const input = screen.getByLabelText('Edit selector pattern')
    fireEvent.change(input, { target: { value: 'Acme' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(notifyInfo).toHaveBeenCalledWith('‘Acme’ is already a selector in this case')
    expect(update).not.toHaveBeenCalled()
  })

  it('says a taken tag name is taken, without trying the create', async () => {
    const create = vi.fn(async () => tags[0])
    install({ tags: { create } })
    renderScreen()
    await screen.findByTestId('signal-row-t1')

    const input = screen.getByTestId('add-tag-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'Evidence' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(create).not.toHaveBeenCalled()
    expect(notifyInfo).toHaveBeenCalledWith('A tag named ‘evidence’ already exists')
    expect(notifyError).not.toHaveBeenCalled()
    expect(input.value).toBe('Evidence')
  })

  it('refuses to rename a tag onto another tag’s name', async () => {
    const updateTag = vi.fn(async () => tags[0])
    install({
      tags: {
        list: vi.fn(async () => [...tags, { id: 't2', name: 'finance', color: '#3b82f6' }]),
        update: updateTag
      }
    })
    renderScreen()
    await screen.findByTestId('signal-row-t2')

    fireEvent.doubleClick(screen.getByTestId('signal-row-t2'))
    const input = screen.getByLabelText('Edit tag name')
    fireEvent.change(input, { target: { value: 'EVIDENCE' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(notifyInfo).toHaveBeenCalledWith('A tag named ‘EVIDENCE’ already exists')
    expect(updateTag).not.toHaveBeenCalled()
  })
})

describe('SignalsOverview selector menu additions (#1549)', () => {
  it('duplicates a selector into the add row, where the unchanged copy is refused', async () => {
    const create = vi.fn(async () => selectors[0])
    install({ selectors: { create } })
    renderScreen()

    fireEvent.contextMenu(await screen.findByTestId('signal-row-s2'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-selector-duplicate'))

    const input = screen.getByTestId('add-selector-input') as HTMLInputElement
    await waitFor(() => expect(input.value).toBe('bc1[a-z0-9]+'))
    expect(screen.getByTestId('add-selector-mode').textContent).toBe('.*')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(create).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'bc1q[a-z0-9]+' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({
        caseId: 'case-1',
        pattern: 'bc1q[a-z0-9]+',
        isRegex: true,
        origin: 'manual'
      })
    )
  })

  it('copies the pattern, not the label, from the menu', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderScreen()

    fireEvent.contextMenu(await screen.findByTestId('signal-row-s1'))
    await screen.findByRole('menu')
    fireEvent.click(screen.getByTestId('context-menu-item-selector-copy-pattern'))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('acme'))
    expect(notifySuccess).toHaveBeenCalledWith('Copied pattern')
  })
})

describe('SignalsOverview layout against the mock (#1549)', () => {
  it('calls Enter edit pattern in the legend, as the menu and the editor do', async () => {
    renderScreen()
    await screen.findByTestId('signal-row-s1')

    expect(screen.getByText('edit pattern')).toBeTruthy()
    expect(screen.queryByText('rename')).toBeNull()
  })

  it('caps the tag list at the mock’s 260px', async () => {
    renderScreen()

    expect((await screen.findByTestId('signals-tag-list')).className).toContain('max-h-[260px]')
  })
})

describe('tag menu additions', () => {
  async function openTagMenu() {
    fireEvent.contextMenu(await screen.findByTestId('signal-row-t1'))
    await screen.findByRole('menu')
  }

  it('duplicates the clicked tag with a new name and the same colour', async () => {
    const create = vi.fn().mockResolvedValue({ ...tags[0], id: 'copy', name: 'evidence-copy' })
    install({ tags: { create } })
    renderScreen()
    await openTagMenu()
    fireEvent.click(screen.getByTestId('context-menu-item-tag-duplicate'))
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: 'evidence-copy', color: '#22c55e' })
    )
  })

  it('exports every tagged capture beyond the coverage preview and excludes other tags', async () => {
    const all = Array.from({ length: 30 }, (_, index) => ({ ...captures[0], id: `cap-${index}` }))
    const ids = all.slice(1).map((capture) => capture.id)
    const capturesWithAnyTag = vi.fn().mockResolvedValue(ids)
    install({ tags: { capturesWithAnyTag }, captures: { list: vi.fn().mockResolvedValue(all) } })
    renderScreen()
    await openTagMenu()
    fireEvent.click(screen.getByTestId('context-menu-item-tag-export'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'ZIP + manifest' }))
    const dialog = await screen.findByTestId('tag-export-dialog')
    expect(capturesWithAnyTag).toHaveBeenCalledWith('case-1', ['t1'])
    expect(dialog.textContent).toContain(ids.join(','))
    expect(dialog.textContent).not.toContain('cap-0,')
    fireEvent.click(screen.getByRole('button', { name: 'Close scoped export' }))
    expect(screen.queryByTestId('tag-export-dialog')).toBeNull()
  })

  it('copies a scoped Markdown reference list without opening an evidence export', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    renderScreen()
    await openTagMenu()
    fireEvent.click(screen.getByTestId('context-menu-item-tag-export'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy as markdown' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce())
    expect(writeText.mock.calls[0][0]).toContain('Page A')
    expect(writeText.mock.calls[0][0]).toContain('not a verified evidence package')
    expect(screen.queryByTestId('tag-export-dialog')).toBeNull()
  })

  it('never falls back to whole-case export when a tag has no captures', async () => {
    install({ tags: { capturesWithAnyTag: vi.fn().mockResolvedValue([]) } })
    renderScreen()
    await openTagMenu()
    fireEvent.click(screen.getByTestId('context-menu-item-tag-export'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'ZIP + manifest' }))
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(screen.queryByTestId('tag-export-dialog')).toBeNull()
  })

  it('reports a rejected export read', async () => {
    install({
      tags: { capturesWithAnyTag: vi.fn().mockRejectedValue(new Error('DB unavailable')) }
    })
    renderScreen()
    await openTagMenu()
    fireEvent.click(screen.getByTestId('context-menu-item-tag-export'))
    fireEvent.click(screen.getByRole('menuitem', { name: 'ZIP + manifest' }))
    await waitFor(() => expect(notifyError).toHaveBeenCalled())
    expect(screen.queryByTestId('tag-export-dialog')).toBeNull()
  })

  it('reports a rejected duplicate', async () => {
    install({ tags: { create: vi.fn().mockRejectedValue(new Error('Duplicate name')) } })
    renderScreen()
    await openTagMenu()
    fireEvent.click(screen.getByTestId('context-menu-item-tag-duplicate'))
    await waitFor(() => expect(notifyError).toHaveBeenCalled())
  })
})
