// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { CaseManifestSnapshot } from '@shared/manifestSnapshot'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case1' }),
  useNavigate: () => vi.fn()
}))
vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

import { DataExplorer } from '@renderer/components/dashboard/cases/DataExplorer'
import { queryKeys } from '@renderer/lib/api/keys'
import { fakeBridge } from '../renderer/fakeBridge'
import { CAPTURES, HASH_A, INVENTORY } from '../renderer/dataFixtures'

function renderExplorer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<DataExplorer />, { wrapper: Wrapper })
  return client
}

beforeEach(() => {
  fakeBridge({
    exhibits: { inventory: vi.fn(async () => ({ caseId: 'case1', rows: INVENTORY })) },
    captures: { list: vi.fn(async () => CAPTURES), getContent: vi.fn(async () => null) },
    selectors: {
      list: vi.fn(async () => [{ id: 's1' }, { id: 's2' }]),
      matchCounts: vi.fn(async () => ({})),
      matchingCaptures: vi.fn(async () => [])
    },
    manifest: {
      snapshot: vi.fn(async () => ({
        caseId: 'case1',
        entries: [{ index: 0, parsed: false, reason: 'x' }],
        chain: { valid: true },
        signers: [],
        head: null
      }))
    },
    extractedData: {
      count: vi.fn(async () => 5),
      categories: vi.fn(async () => [{ category: 'emails', count: 1 }]),
      subcategories: vi.fn(async () => []),
      items: vi.fn(async () => []),
      search: vi.fn(async () => [])
    }
  })
})

afterEach(() => cleanup())

// The suite has no jest-dom matchers; text() reads a node's content for
// a plain toContain, and a nextSibling is the <dd> after a <dt>.
function text(node: Element | ChildNode | null | undefined): string {
  return node?.textContent ?? ''
}

async function tree() {
  return within(await screen.findByRole('tree', { name: 'Case data' }))
}

describe('DataExplorer (#1149)', () => {
  it('renders the four groups without counts, and counts on the rows under them', async () => {
    renderExplorer()
    const rail = await tree()
    expect(text(rail.getByTestId('data-tree-node-data-sources'))).toContain('Data Sources')
    expect(text(rail.getByTestId('data-tree-node-staging'))).toContain('Staging')
    for (const group of ['data-sources', 'staging', 'views', 'results']) {
      expect(rail.queryByTestId(`data-tree-count-${group}`)).toBeNull()
    }
    expect(text(rail.getByTestId('data-tree-count-kind:capture'))).toContain('3')
    expect(rail.getByTestId('data-tree-node-views')).toBeTruthy()
    expect(rail.getByTestId('data-tree-node-results')).toBeTruthy()
    expect(text(rail.getByTestId('data-tree-node-kind:capture'))).toContain('Captures')
    await waitFor(() =>
      expect(text(rail.getByTestId('data-tree-count-keyword-hits'))).toContain('2')
    )
    expect(text(rail.getByTestId('data-tree-count-indicators'))).toContain('5')
    expect(text(rail.getByTestId('data-tree-count-manifest-ledger'))).toContain('1')
    // One Capture's persisted verify state is tampered; its thumbnail has no
    // persisted state and the renderer infers none for it (X36).
    expect(text(rail.getByTestId('data-tree-count-integrity-exceptions'))).toContain('1')
  })

  it('rows read the density token for their height', async () => {
    renderExplorer()
    const rail = await tree()
    const row = rail.getByText('Captures').closest('button')
    expect(row?.className).toContain('h-[var(--d-tree)]')
  })

  it('shows every anchored row in the table with the six columns, and a pooled row only under Staging', async () => {
    renderExplorer()
    const table = within(await screen.findByTestId('artifact-table'))
    expect(table.getByText('Name')).toBeTruthy()
    for (const head of ['Source', 'Kind', 'Size', 'SHA-256', 'Captured']) {
      expect(table.getByText(head)).toBeTruthy()
    }
    expect(text(table.getByTestId('artifact-row-cap-a'))).not.toContain('example.com')
    expect(text(table.getByTestId('artifact-row-thumb-a'))).toContain('Exhibit 1')
    expect(text(table.getByTestId('artifact-row-cap-a'))).toContain(`${HASH_A.slice(0, 14)}…`)
    expect(text(table.getByTestId('artifact-row-cap-a'))).toContain('Exhibit 1')
    expect(text(table.getByTestId('artifact-row-thumb-a'))).toContain('thumbnail')
    // CAPTURED is the Capture's capture time on the Capture and on its Derived
    // File, read from the Capture row and not the inventory's commit time.
    expect(text(table.getByTestId('artifact-row-cap-a'))).toContain('2026-09-01 09:58')
    expect(text(table.getByTestId('artifact-row-thumb-a'))).toContain('2026-09-01 09:58')
    expect(table.queryByTestId('artifact-row-staged-1')).toBeNull()

    // A legacy Capture with no entry and no file says both.
    const legacy = table.getByTestId('artifact-row-cap-legacy')
    expect(text(within(legacy).getByTestId('unanchored-cap-legacy'))).toContain('unanchored')
    expect(within(legacy).getByLabelText('File missing on disk')).toBeTruthy()

    fireEvent.click(
      (await tree()).getByTestId('data-tree-node-staging').querySelector('button:last-of-type')!
    )
    const staged = await screen.findByTestId('artifact-row-staged-1')
    expect(text(within(staged).getByTestId('not-anchored-staged-1'))).toContain('not anchored')
    expect(screen.queryByTestId('artifact-row-cap-a')).toBeNull()
  })

  it('renders the Staging group with Upload, and inline Commit and Discard on the pooled row', async () => {
    renderExplorer()
    fireEvent.click(
      (await tree()).getByTestId('data-tree-node-staging').querySelector('button:last-of-type')!
    )
    expect(((await screen.findByTestId('staging-upload')) as HTMLButtonElement).disabled).toBe(
      false
    )
    expect((screen.getByTestId('staging-commit-staged-1') as HTMLButtonElement).disabled).toBe(
      false
    )
    expect((screen.getByTestId('staging-discard-staged-1') as HTMLButtonElement).disabled).toBe(
      false
    )
  })

  it('search filters the table by name, kind, hash and Exhibit, and never says text', async () => {
    renderExplorer()
    const input = await screen.findByTestId('data-search')
    expect((input as HTMLInputElement).placeholder).not.toMatch(/text/i)
    fireEvent.change(input, { target: { value: HASH_A.slice(0, 10) } })
    expect(await screen.findByTestId('artifact-row-cap-a')).toBeTruthy()
    expect(screen.queryByTestId('artifact-row-cap-legacy')).toBeNull()
    fireEvent.change(input, { target: { value: 'Exhibit 2' } })
    expect(await screen.findByTestId('artifact-row-cap-legacy')).toBeTruthy()
    expect(screen.queryByTestId('artifact-row-cap-a')).toBeNull()
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(await screen.findByText('No files match this search.')).toBeTruthy()
  })

  // The strip used to close when the search hid the selected row and to be
  // absent until a row was clicked; the mock falls back to the first file
  // (#1552), and the strip is now absent only when the table is empty.
  it('shows the first row in the strip with nothing selected, with the breadcrumb', async () => {
    renderExplorer()
    const strip = within(await screen.findByTestId('artifact-tabs'))
    expect(strip.getByText('Example page')).toBeTruthy()
    expect(text(strip.getByTestId('artifact-tabs-subtitle'))).toBe('Exhibit 1 / raw')
    expect(screen.getByTestId('artifact-row-cap-a').getAttribute('aria-selected')).toBe('false')
    // The strip is the larger pane, as in the mock.
    expect(screen.getByTestId('artifact-tabs').className).toContain('flex-[1.2]')

    fireEvent.click(screen.getByTestId('artifact-row-thumb-a'))
    await waitFor(() =>
      expect(text(screen.getByTestId('artifact-tabs-subtitle'))).toBe('Exhibit 1 / derived')
    )
  })

  it('falls back to the first visible row when the search hides the selected one', async () => {
    renderExplorer()
    fireEvent.click(await screen.findByTestId('artifact-row-thumb-a'))
    fireEvent.change(screen.getByTestId('data-search'), { target: { value: 'Old page' } })
    await waitFor(() =>
      expect(within(screen.getByTestId('artifact-tabs')).getByText('Old page')).toBeTruthy()
    )
    expect(text(screen.getByTestId('artifact-tabs-subtitle'))).toBe('Exhibit 2 / raw')
    fireEvent.change(screen.getByTestId('data-search'), { target: { value: 'zzz' } })
    await waitFor(() => expect(screen.queryByTestId('artifact-tabs')).toBeNull())
  })

  it('selecting a row opens the strip with the Properties tab', async () => {
    renderExplorer()
    fireEvent.click(await screen.findByTestId('artifact-row-cap-a'))
    const strip = within(await screen.findByTestId('artifact-tabs'))
    // No extracted text and no headers are stubbed, and the stubbed snapshot's
    // only line is unreadable, so no entry names the row: Properties alone
    // (#1150, a tab with no data is absent).
    expect(strip.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Properties'])
    const props = within(strip.getByTestId('properties-tab'))
    expect(text(props.getByText('Exhibit Number').nextSibling)).toContain('Exhibit 1')
    expect(text(props.getByText('Origin').nextSibling)).toContain('extension')
    expect(text(props.getByText('Size (recorded at ingest)').nextSibling)).toContain('2.0 KB')
    expect(text(props.getByText('Relative path').nextSibling)).toContain('case1/cap-a.mhtml')
    expect(text(props.getByText('Collector').nextSibling)).toContain(
      'Birdbrain 1.4.2 · extension 1.4.0 · browser Chrome 140'
    )
    expect(text(props.getByText('SHA-256').nextSibling)).toContain(HASH_A)
  })

  it('shows parent and derivation for a Derived File', async () => {
    renderExplorer()
    fireEvent.click(await screen.findByTestId('artifact-row-thumb-a'))
    fireEvent.click(await screen.findByRole('tab', { name: 'Properties' }))
    const props = within(await screen.findByTestId('properties-tab'))
    expect(text(props.getByText('Parent').nextSibling)).toContain('Example page')
    expect(text(props.getByText('Derivation').nextSibling)).toContain('thumbnail')
    expect(props.queryByText('Collector')).toBeNull()
  })

  it('keeps the IOC browser reachable as Results > Indicators', async () => {
    renderExplorer()
    fireEvent.click(
      (await tree()).getByTestId('data-tree-node-indicators').querySelector('button:last-of-type')!
    )
    expect(await screen.findByPlaceholderText('Search indicators...')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Reprocess/ })).toBeTruthy()
    expect(screen.queryByTestId('artifact-table')).toBeNull()
  })

  it('titles the main pane for every node kind, and collapses a subtree from its twist', async () => {
    renderExplorer()
    const rail = await tree()
    const select = (key: string) =>
      fireEvent.click(
        rail.getByTestId(`data-tree-node-${key}`).querySelector('button:last-of-type')!
      )
    const heading = () => screen.getByTestId('data-node-title').textContent

    expect(heading()).toBe('All data sources')
    select('kind:capture')
    expect(heading()).toBe('Captures')
    select('views')
    expect(heading()).toBe('File types')
    fireEvent.click(rail.getByLabelText('Expand File Types'))
    select('file-type:MHTML')
    expect(heading()).toBe('MHTML')
    select('results')
    expect(heading()).toBe('Results')
    select('keyword-hits')
    expect(heading()).toBe('Keyword hits')
    select('integrity-exceptions')
    expect(heading()).toBe('Integrity exceptions')
    expect(screen.getByTestId('artifact-row-cap-a')).toBeTruthy()
    expect(screen.queryByTestId('artifact-row-cap-legacy')).toBeNull()
    expect(screen.queryByTestId('artifact-row-thumb-a')).toBeNull()
    select('manifest-ledger')
    expect(heading()).toBe('Manifest ledger')

    fireEvent.click(rail.getByLabelText('Expand Captures'))
    select('exhibit:cap-a')
    expect(heading()).toBe('Example page')
    expect(screen.getByTestId('data-node-subtitle').textContent).toBe('Exhibit 1')
    fireEvent.click(rail.getByLabelText('Expand Example page'))
    select('derived:thumb-a')
    expect(heading()).toBe('thumbnail')
    expect(screen.getByTestId('data-node-subtitle').textContent).toBe('Derived File')

    // Collapsing Data Sources hides the kind subgroup and the rows under it.
    fireEvent.click(rail.getByLabelText('Collapse Data Sources'))
    expect(rail.queryByTestId('data-tree-node-kind:capture')).toBeNull()
    expect(rail.queryByTestId('data-tree-node-exhibit:cap-a')).toBeNull()
  })

  it('modifier-click builds a multi-selection that a node change clears (#1552)', async () => {
    renderExplorer()
    fireEvent.click(await screen.findByTestId('artifact-row-cap-a'), { ctrlKey: true })
    fireEvent.click(screen.getByTestId('artifact-row-thumb-a'), { metaKey: true })
    const multi = () =>
      ['cap-a', 'cap-legacy', 'thumb-a'].filter(
        (id) =>
          screen.getByTestId(`artifact-row-${id}`).getAttribute('data-multi-selected') === 'true'
      )
    expect(multi()).toEqual(['cap-a', 'thumb-a'])
    fireEvent.click(screen.getByTestId('artifact-row-cap-a'), { ctrlKey: true })
    expect(multi()).toEqual(['thumb-a'])
    fireEvent.click(
      (await tree())
        .getByTestId('data-tree-node-kind:capture')
        .querySelector('button:last-of-type')!
    )
    await waitFor(() => expect(multi()).toEqual([]))
  })

  it('clears the search from its button', async () => {
    renderExplorer()
    const input = (await screen.findByTestId('data-search')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'zzz' } })
    expect(await screen.findByText('No files match this search.')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Clear search'))
    expect(input.value).toBe('')
    expect(await screen.findByTestId('artifact-row-cap-a')).toBeTruthy()
  })

  it('shows a pooled row’s properties as not anchored, with its stated source', async () => {
    renderExplorer()
    fireEvent.click(
      (await tree()).getByTestId('data-tree-node-staging').querySelector('button:last-of-type')!
    )
    fireEvent.click(await screen.findByTestId('artifact-row-staged-1'))
    expect(text(screen.getByTestId('artifact-tabs-subtitle'))).toBe('manual-upload / staging')
    // A pooled row has nothing but Properties (#1150).
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Properties'])
    const props = within(await screen.findByTestId('properties-tab'))
    expect(text(props.getByText('Kind').nextSibling)).toBe('Document (not anchored)')
    expect(text(props.getByText('Origin').nextSibling)).toBe('manual-upload')
    expect(text(props.getByText('Arrived').nextSibling)).toBe('2026-09-10T12:00:00.000Z')
    expect(props.queryByText('Exhibit Number')).toBeNull()
  })
})

// A failed inventory read used to look like a clean Case ("No exceptions among
// the verified rows."), and a failed snapshot read like one still in flight.
describe('DataExplorer failed reads (#1656)', () => {
  const EMPTY_SNAPSHOT: CaseManifestSnapshot = {
    caseId: 'case1',
    entries: [],
    chain: { valid: true },
    signers: [],
    head: null,
    citationRule: { prefixed: false, localMemberCode: null }
  }

  async function selectNode(key: string) {
    fireEvent.click(
      (await tree()).getByTestId(`data-tree-node-${key}`).querySelector('button:last-of-type')!
    )
  }

  it('replaces the screen with the error and a retry when the inventory read fails', async () => {
    const inventory = vi.mocked(window.birdbrain.exhibits.inventory)
    inventory.mockRejectedValueOnce(new Error('database is locked'))
    inventory.mockResolvedValue({ caseId: 'case1', rows: [] })
    renderExplorer()

    expect(await screen.findByText('Failed to load case data: database is locked')).toBeTruthy()
    expect(screen.queryByRole('tree')).toBeNull()
    expect(screen.queryByTestId('integrity-strip')).toBeNull()
    expect(screen.queryByTestId('artifact-table')).toBeNull()
    expect(screen.queryByText('No exceptions among the verified rows.')).toBeNull()

    // The retry reads an empty Case, which keeps its existing empty message.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await selectNode('integrity-exceptions')
    expect(await screen.findByText('No exceptions among the verified rows.')).toBeTruthy()
    expect(screen.queryByText(/Failed to load/)).toBeNull()
  })

  // The captures carry each Capture's persisted verify state; without them a
  // tampered Capture used to drop out of the exceptions.
  it('replaces the screen with the error and a retry when the captures read fails', async () => {
    vi.mocked(window.birdbrain.captures.list).mockRejectedValueOnce(new Error('disk offline'))
    renderExplorer()

    expect(await screen.findByText('Failed to load captures: disk offline')).toBeTruthy()
    expect(screen.queryByRole('tree')).toBeNull()
    expect(screen.queryByTestId('artifact-table')).toBeNull()
    expect(screen.queryByText('No exceptions among the verified rows.')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    await selectNode('integrity-exceptions')
    expect(await screen.findByTestId('artifact-row-cap-a')).toBeTruthy()
    expect(screen.queryByText(/Failed to load/)).toBeNull()
  })

  it('shows the error and a retry on the Manifest Ledger node when the snapshot read fails', async () => {
    const snapshot = vi.mocked(window.birdbrain.manifest.snapshot)
    snapshot.mockRejectedValueOnce(new Error('manifest unreadable'))
    snapshot.mockResolvedValue(EMPTY_SNAPSHOT)
    renderExplorer()
    await selectNode('manifest-ledger')

    expect(await screen.findByText('Failed to load the ledger: manifest unreadable')).toBeTruthy()
    expect(screen.queryByText('Loading the ledger…')).toBeNull()
    expect(screen.queryByTestId('data-tree-count-manifest-ledger')).toBeNull()

    // The retry reads an empty ledger, which keeps its existing empty message.
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText('No entries.')).toBeTruthy()
    expect(screen.queryByText(/Failed to load/)).toBeNull()
  })

  it('withdraws the verdict and the ledger count when a later snapshot read fails', async () => {
    const client = renderExplorer()
    await selectNode('manifest-ledger')
    expect((await screen.findAllByTestId('chain-verdict')).length).toBeGreaterThan(0)
    expect(text(screen.getByTestId('data-tree-count-manifest-ledger'))).toContain('1')

    vi.mocked(window.birdbrain.manifest.snapshot).mockRejectedValueOnce(
      new Error('manifest unreadable')
    )
    await act(() => client.invalidateQueries({ queryKey: queryKeys.manifestSnapshot('case1') }))

    expect(await screen.findByText('Failed to load the ledger: manifest unreadable')).toBeTruthy()
    expect(screen.queryAllByTestId('chain-verdict')).toEqual([])
    expect(screen.queryByTestId('manifest-ledger-view')).toBeNull()
    expect(screen.queryByTestId('data-tree-count-manifest-ledger')).toBeNull()
  })
})
