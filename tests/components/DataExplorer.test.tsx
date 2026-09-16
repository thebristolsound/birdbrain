// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case1' }),
  useNavigate: () => vi.fn()
}))
vi.mock('@renderer/lib/notify', () => ({
  notify: { error: vi.fn(), warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

import { DataExplorer } from '@renderer/components/dashboard/cases/DataExplorer'
import { fakeBridge } from '../renderer/fakeBridge'
import { CAPTURES, HASH_A, INVENTORY } from '../renderer/dataFixtures'

function renderExplorer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<DataExplorer />, { wrapper: Wrapper })
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
  it('renders the four groups with counts and the kind subgroup', async () => {
    renderExplorer()
    const rail = await tree()
    expect(text(rail.getByTestId('data-tree-node-data-sources'))).toContain('Data Sources')
    expect(text(rail.getByTestId('data-tree-count-data-sources'))).toContain('3')
    expect(text(rail.getByTestId('data-tree-node-staging'))).toContain('Staging')
    expect(text(rail.getByTestId('data-tree-count-staging'))).toContain('1')
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
    expect(text(table.getByTestId('artifact-row-cap-a'))).toContain('example.com')
    expect(text(table.getByTestId('artifact-row-cap-a'))).toContain(HASH_A.slice(0, 12))
    expect(text(table.getByTestId('artifact-row-cap-a'))).toContain('Exhibit 1')
    expect(text(table.getByTestId('artifact-row-thumb-a'))).toContain('thumbnail')
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

  it('closes the strip when the search hides the selected row', async () => {
    renderExplorer()
    fireEvent.click(await screen.findByTestId('artifact-row-cap-a'))
    expect(await screen.findByTestId('artifact-tabs')).toBeTruthy()
    fireEvent.change(screen.getByTestId('data-search'), { target: { value: 'Old page' } })
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
    // A pooled row has nothing but Properties (#1150).
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Properties'])
    const props = within(await screen.findByTestId('properties-tab'))
    expect(text(props.getByText('Kind').nextSibling)).toBe('Document (not anchored)')
    expect(text(props.getByText('Origin').nextSibling)).toBe('manual-upload')
    expect(text(props.getByText('Arrived').nextSibling)).toBe('2026-09-10T12:00:00.000Z')
    expect(props.queryByText('Exhibit Number')).toBeNull()
  })
})
