// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { CaseManifestSnapshot } from '@shared/manifestSnapshot'

const navigate = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case1' }),
  useNavigate: () => navigate
}))
const notifySuccess = vi.hoisted(() => vi.fn())
vi.mock('@renderer/lib/notify', () => ({
  notify: { success: notifySuccess, error: vi.fn(), warn: vi.fn(), info: vi.fn() }
}))

import { DataExplorer } from '@renderer/components/dashboard/cases/DataExplorer'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { CAPTURES, HASH_A, HASH_STAGED, INVENTORY } from '../renderer/dataFixtures'

const SNAPSHOT: CaseManifestSnapshot = {
  caseId: 'case1',
  entries: [
    {
      index: 0,
      parsed: true,
      entry: {
        type: 'capture',
        captureId: 'cap-a',
        caseId: 'case1',
        url: 'https://example.com/page',
        timestamp: '2026-09-01T10:00:00.000Z',
        contentHash: HASH_A,
        sizeBytes: 2048,
        operatorId: 'op',
        operatorName: 'Op',
        toolVersion: '1.0.0',
        index: 0,
        prevHash: '',
        schemaVersion: 2,
        entryHash: 'e'.repeat(64)
      }
    }
  ],
  chain: { valid: true },
  signers: [],
  head: { index: 0, entryHash: 'e'.repeat(64) }
}

let verify: ReturnType<typeof vi.fn>
let upload: ReturnType<typeof vi.fn>
let commit: ReturnType<typeof vi.fn>
let discard: ReturnType<typeof vi.fn>
let writeText: ReturnType<typeof vi.fn>
let snapshot: ReturnType<typeof vi.fn>
let selectorsList: ReturnType<typeof vi.fn>
let matchCounts: ReturnType<typeof vi.fn>
let matchingCaptures: ReturnType<typeof vi.fn>

function renderExplorer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<DataExplorer />, { wrapper: Wrapper })
}

async function tree() {
  return within(await screen.findByRole('tree', { name: 'Case data' }))
}

async function select(key: string) {
  fireEvent.click(
    (await tree()).getByTestId(`data-tree-node-${key}`).querySelector('button:last-of-type')!
  )
}

async function openMenu(element: HTMLElement) {
  fireEvent.contextMenu(element)
  return screen.findByRole('menu')
}

// A right-click that mounts nothing. Radix opens its menu synchronously on
// the event, so a tick later is a settled answer, not a race.
async function expectNoMenu(element: HTMLElement) {
  fireEvent.contextMenu(element)
  await new Promise((resolve) => setTimeout(resolve, 20))
  expect(screen.queryByRole('menu')).toBeNull()
}

function item(menu: HTMLElement, id: string) {
  return within(menu).getByTestId(`context-menu-item-${id}`)
}

beforeEach(() => {
  verify = vi.fn(async (_caseId: string, exhibitId: string) => ({
    exhibitId,
    caseId: 'case1',
    kind: 'capture',
    status: 'verified'
  }))
  upload = vi.fn(async () => [])
  commit = vi.fn(async (_caseId: string, ids: string[]) => ({
    outcomes: ids.map((stagingId) => ({
      stagingId,
      status: 'committed',
      exhibitId: 'ex-new',
      exhibitNumber: 3
    }))
  }))
  discard = vi.fn(async (_caseId: string, ids: string[]) => ({ discarded: ids }))
  writeText = vi.fn(async () => undefined)
  snapshot = vi.fn(async () => SNAPSHOT)
  selectorsList = vi.fn(async () => [])
  matchCounts = vi.fn(async () => ({}))
  matchingCaptures = vi.fn(async () => [])
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  fakeBridge({
    exhibits: {
      inventory: vi.fn(async () => ({ caseId: 'case1', rows: INVENTORY })),
      verify
    },
    captures: { list: vi.fn(async () => CAPTURES), getContent: vi.fn(async () => null) },
    selectors: { list: selectorsList, matchCounts, matchingCaptures },
    manifest: { snapshot },
    extractedData: { count: vi.fn(async () => 0) },
    staging: { upload, commit, discard }
  })
  useAppStore.getState().setSelectedCaptureId(null)
})

afterEach(() => {
  cleanup()
  navigate.mockReset()
  notifySuccess.mockReset()
})

describe('Data screen context menus (#1151)', () => {
  it('exhibit row: names the row, copies the hash and path unchanged, verifies, and opens the viewer', async () => {
    renderExplorer()
    const menu = await openMenu(await screen.findByTestId('artifact-row-cap-a'))
    expect(menu.getAttribute('aria-label')).toBe('Exhibit actions: Example page')
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((el) => el.textContent)
    ).toEqual(['Open in viewerEnter', 'Copy SHA-256', 'Copy relative path', 'Verify'])

    fireEvent.click(item(menu, 'exhibit-copy-hash'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH_A))

    const again = await openMenu(await screen.findByTestId('artifact-row-cap-a'))
    fireEvent.click(item(again, 'exhibit-copy-path'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('case1/cap-a.mhtml'))

    const third = await openMenu(await screen.findByTestId('artifact-row-cap-a'))
    fireEvent.click(item(third, 'exhibit-verify'))
    await waitFor(() => expect(verify).toHaveBeenCalledWith('case1', 'cap-a'))

    const fourth = await openMenu(await screen.findByTestId('artifact-row-cap-a'))
    fireEvent.click(item(fourth, 'exhibit-open'))
    expect(useAppStore.getState().selectedCaptureId).toBe('cap-a')
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case1' }
    })
  })

  it('derived row: opens and verifies the parent Capture', async () => {
    renderExplorer()
    const menu = await openMenu(await screen.findByTestId('artifact-row-thumb-a'))
    expect(menu.getAttribute('aria-label')).toBe('Exhibit actions: thumbnail')
    expect(item(menu, 'exhibit-open').textContent).toContain('Open parent in viewer')
    fireEvent.click(item(menu, 'exhibit-verify'))
    await waitFor(() => expect(verify).toHaveBeenCalledWith('case1', 'cap-a'))
  })

  it('inline routes: Enter opens the viewer, the strip verifies, Properties copies', async () => {
    renderExplorer()
    const row = await screen.findByTestId('artifact-row-cap-a')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(navigate).toHaveBeenCalledTimes(1)

    // Enter on an inline button is that button's activation, not an open: the
    // row handler neither cancels it nor opens anything.
    await select('staging')
    const commitButton = await screen.findByTestId('staging-commit-staged-1')
    expect(fireEvent.keyDown(commitButton, { key: 'Enter' })).toBe(true)
    expect(navigate).toHaveBeenCalledTimes(1)
    await select('data-sources')
    fireEvent.click(await screen.findByTestId('artifact-row-cap-a'))

    fireEvent.click(await screen.findByTestId('row-verify'))
    await waitFor(() => expect(verify).toHaveBeenCalledWith('case1', 'cap-a'))

    fireEvent.click(screen.getByRole('tab', { name: 'Properties' }))
    fireEvent.click(screen.getByTestId('copy-sha-256'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH_A))
    fireEvent.click(screen.getByTestId('copy-relative-path'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('case1/cap-a.mhtml'))

    // The pane header verifies every Exhibit under the node.
    fireEvent.click(screen.getByTestId('node-verify'))
    await waitFor(() => expect(verify).toHaveBeenCalledWith('case1', 'cap-legacy'))
  })

  it('tree node: expands and collapses below, verifies the subtree, shows only this', async () => {
    renderExplorer()
    const rail = await tree()
    const menu = await openMenu(rail.getByTestId('data-tree-node-kind:capture'))
    expect(menu.getAttribute('aria-label')).toBe('Node actions: Captures')

    fireEvent.click(item(menu, 'node-expand-below'))
    expect(rail.getByTestId('data-tree-node-exhibit:cap-a')).toBeTruthy()
    expect(rail.getByTestId('data-tree-node-derived:thumb-a')).toBeTruthy()

    const second = await openMenu(rail.getByTestId('data-tree-node-kind:capture'))
    fireEvent.click(item(second, 'node-collapse-below'))
    expect(rail.queryByTestId('data-tree-node-exhibit:cap-a')).toBeNull()

    const third = await openMenu(rail.getByTestId('data-tree-node-kind:capture'))
    fireEvent.click(item(third, 'node-verify'))
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(2))
    expect(verify.mock.calls.map((c) => c[1])).toEqual(['cap-a', 'cap-legacy'])

    // Shift+click on a twist is the inline route for Expand below.
    fireEvent.click(rail.getByLabelText('Expand Captures'), { shiftKey: true })
    expect(rail.getByTestId('data-tree-node-derived:thumb-a')).toBeTruthy()
  })

  it('node Verify on Integrity Exceptions covers the exceptions shown this session', async () => {
    renderExplorer()
    const rail = await tree()
    // The persisted-tampered Capture is the node's only row; once its verify
    // comes back clean the node is empty and Verify goes off.
    const first = await openMenu(rail.getByTestId('data-tree-node-integrity-exceptions'))
    expect(item(first, 'node-verify').getAttribute('data-disabled')).toBeNull()
    fireEvent.click(item(first, 'node-verify'))
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1))
    expect(verify.mock.calls[0][1]).toBe('cap-a')
    await waitFor(() =>
      expect(rail.getByTestId('data-tree-count-integrity-exceptions').textContent).toBe('0')
    )
    // Nothing left to verify and nothing to expand: the node has no menu.
    await expectNoMenu(rail.getByTestId('data-tree-node-integrity-exceptions'))
  })

  it('mounts no menu on a group head, on a Derived File node, or on Manifest Ledger', async () => {
    renderExplorer()
    const rail = await tree()
    // Group heads render as eyebrows, not rows; Staging also holds no
    // Exhibits, so it would offer nothing either way.
    await expectNoMenu(rail.getByTestId('data-tree-node-data-sources'))
    await expectNoMenu(rail.getByTestId('data-tree-node-staging'))
    // The ledger lists entries, not Exhibits, and has no subtree.
    await expectNoMenu(rail.getByTestId('data-tree-node-manifest-ledger'))
    // A Derived File node is a leaf and its row is not an Exhibit; the row's
    // own menu in the table verifies the parent instead.
    fireEvent.click(rail.getByLabelText('Expand Captures'), { shiftKey: true })
    await expectNoMenu(rail.getByTestId('data-tree-node-derived:thumb-a'))
    expect(verify).not.toHaveBeenCalled()
  })

  it('a leaf with Exhibits offers Show only this and Verify, without the subtree items', async () => {
    renderExplorer()
    const rail = await tree()
    fireEvent.click(rail.getByLabelText('Expand File Types'))
    const menu = await openMenu(rail.getByTestId('data-tree-node-file-type:MHTML'))
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((el) => el.textContent)
    ).toEqual(['Show only thisEnter', 'Verify'])
    fireEvent.click(item(menu, 'node-show-only'))
    expect(screen.getByTestId('data-node-title').textContent).toBe('MHTML')
  })

  it('node Verify on a Selector node: the pane header covers exactly the matched rows', async () => {
    selectorsList.mockResolvedValue([
      { id: 's1', caseId: 'case1', pattern: 'proton', isRegex: false, enabled: true }
    ])
    matchCounts.mockResolvedValue({ s1: 1 })
    matchingCaptures.mockResolvedValue(['cap-legacy'])
    renderExplorer()
    const rail = await tree()
    await waitFor(() => expect(rail.getByLabelText('Expand Keyword Hits')).toBeTruthy())
    fireEvent.click(rail.getByLabelText('Expand Keyword Hits'))
    await select('keyword:s1')
    expect(await screen.findByTestId('artifact-row-cap-legacy')).toBeTruthy()

    // The header reads the same session context as the table and the menu,
    // so the Selector's hits are what it verifies — not nothing, not everything.
    fireEvent.click(await screen.findByTestId('node-verify'))
    await waitFor(() => expect(verify).toHaveBeenCalledTimes(1))
    expect(verify.mock.calls[0][1]).toBe('cap-legacy')

    const menu = await openMenu(rail.getByTestId('data-tree-node-keyword:s1'))
    expect(item(menu, 'node-verify').getAttribute('data-disabled')).toBeNull()
  })

  it('staged row: commits, confirms a discard, and copies the hash labelled not anchored', async () => {
    renderExplorer()
    await select('staging')
    const row = await screen.findByTestId('artifact-row-staged-1')

    const menu = await openMenu(row)
    expect(menu.getAttribute('aria-label')).toBe('Pooled file actions: report.pdf')
    fireEvent.click(item(menu, 'staged-copy-hash'))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH_STAGED))
    expect(notifySuccess).toHaveBeenCalledWith('Copied SHA-256 (not anchored)')

    const second = await openMenu(await screen.findByTestId('artifact-row-staged-1'))
    fireEvent.click(item(second, 'staged-discard'))
    const dialog = await screen.findByTestId('discard-staged-dialog')
    expect(discard).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByTestId('discard-staged-cancel'))
    await waitFor(() => expect(screen.queryByTestId('discard-staged-dialog')).toBeNull())

    fireEvent.click(screen.getByTestId('staging-discard-staged-1'))
    fireEvent.click(
      within(await screen.findByTestId('discard-staged-dialog')).getByTestId(
        'discard-staged-confirm'
      )
    )
    await waitFor(() => expect(discard).toHaveBeenCalledWith('case1', ['staged-1']))

    const third = await openMenu(await screen.findByTestId('artifact-row-staged-1'))
    fireEvent.click(item(third, 'staged-commit'))
    await waitFor(() => expect(commit).toHaveBeenCalledWith('case1', ['staged-1']))

    fireEvent.click(screen.getByTestId('staging-commit-staged-1'))
    await waitFor(() => expect(commit).toHaveBeenCalledTimes(2))

    fireEvent.click(screen.getByTestId('staging-upload'))
    await waitFor(() => expect(upload).toHaveBeenCalledWith('case1'))
  })

  it('ledger entry: no menu; the row click shows its target and the cells copy on click', async () => {
    renderExplorer()
    await select('manifest-ledger')
    const row = await screen.findByTestId('ledger-row-0')
    // Everything the entry can do is on the row itself, so a menu would only
    // repeat it.
    await expectNoMenu(row)
    fireEvent.click(within(row).getByTitle(/click to copy/))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('e'.repeat(64)))

    fireEvent.click(await screen.findByTestId('ledger-row-0'))
    expect(screen.getByTestId('data-node-title').textContent).toBe('Example page')
    expect((await screen.findByTestId('artifact-row-cap-a')).getAttribute('aria-selected')).toBe(
      'true'
    )
  })

  it('ledger row: Enter on a hash cell is that cell’s copy, Enter on the row shows its target', async () => {
    renderExplorer()
    await select('manifest-ledger')
    const row = await screen.findByTestId('ledger-row-0')
    const cell = within(row).getByTitle(/click to copy/)
    // Not cancelled, so the button's own activation (its click) is what runs;
    // the row does not read it as a Show target.
    expect(fireEvent.keyDown(cell, { key: 'Enter' })).toBe(true)
    expect(screen.getByTestId('data-node-title').textContent).toBe('Manifest ledger')
    fireEvent.click(cell)
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('e'.repeat(64)))
    expect(screen.getByTestId('data-node-title').textContent).toBe('Manifest ledger')

    fireEvent.keyDown(row, { key: 'Enter' })
    expect(screen.getByTestId('data-node-title').textContent).toBe('Example page')
  })

  it('ledger row: an unreadable line shows no hash and copies none; only a readable first entry reads genesis', async () => {
    snapshot.mockResolvedValue({
      ...SNAPSHOT,
      entries: [...SNAPSHOT.entries, { index: 1, parsed: false, reason: 'bad json' }]
    })
    renderExplorer()
    await select('manifest-ledger')
    const cells = (id: string) =>
      Array.from(screen.getByTestId(id).children).map((el) => el.textContent)
    expect(cells('ledger-row-0').slice(4)).toEqual(['e'.repeat(12), 'genesis'])
    expect(cells('ledger-row-1').slice(2)).toEqual(['unreadable', 'bad json', '', ''])
    expect(within(screen.getByTestId('ledger-row-1')).queryByTitle(/click to copy/)).toBeNull()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('never offers a reveal-in-folder route', async () => {
    renderExplorer()
    for (const id of ['artifact-row-cap-a', 'artifact-row-thumb-a']) {
      const menu = await openMenu(await screen.findByTestId(id))
      expect(within(menu).queryByText(/reveal|folder|absolute/i)).toBeNull()
      fireEvent.keyDown(menu, { key: 'Escape' })
    }
  })
})
