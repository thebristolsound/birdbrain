// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case1' })
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
    captures: { list: vi.fn(async () => CAPTURES) },
    selectors: { list: vi.fn(async () => [{ id: 's1' }, { id: 's2' }]) },
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
    // One Capture's persisted verify state is tampered.
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

  it('renders the Staging group with Upload, Commit and Discard inert until #1148', async () => {
    renderExplorer()
    fireEvent.click(
      (await tree()).getByTestId('data-tree-node-staging').querySelector('button:last-of-type')!
    )
    expect(((await screen.findByTestId('staging-upload')) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('staging-commit-staged-1') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('staging-discard-staged-1') as HTMLButtonElement).disabled).toBe(
      true
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

  it('selecting a row opens the strip with the Properties tab', async () => {
    renderExplorer()
    fireEvent.click(await screen.findByTestId('artifact-row-cap-a'))
    const strip = within(await screen.findByTestId('artifact-tabs'))
    expect(strip.getByRole('tab', { name: 'Properties' })).toBeTruthy()
    expect(strip.getAllByRole('tab')).toHaveLength(1)
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
})
