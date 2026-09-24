// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { fakeBridge } from '../renderer/fakeBridge'

const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate
}))

import { SearchBar } from '@renderer/components/search/SearchBar'

let captureHits: Array<{ id: string; caseId: string; title: string; url: string }>
let noteHits: Array<{ id: string; caseId: string; title: string; body: string }>

function renderBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<SearchBar caseId="case1" />, { wrapper: Wrapper })
}

function type(value: string) {
  fireEvent.change(screen.getByTestId('global-search-input'), { target: { value } })
}

beforeEach(() => {
  captureHits = []
  noteHits = []
  navigate.mockClear()
  fakeBridge({
    search: vi.fn(async () => captureHits),
    notes: { search: vi.fn(async () => noteHits) }
  })
})

afterEach(() => {
  cleanup()
})

describe('the top-bar search', () => {
  it('uses the short placeholder', () => {
    renderBar()
    expect(screen.getByTestId('global-search-input').getAttribute('placeholder')).toBe(
      'Search this case…'
    )
  })

  it('opens on text alone and reports a query that matches nothing', async () => {
    renderBar()
    type('kestrel')

    expect(screen.getByTestId('global-search-results').textContent).toBe('Searching...')
    expect(await screen.findByText('No matches in this case')).toBeTruthy()
    expect(screen.queryByText('Searching...')).toBeNull()
  })

  it('lists capture and note hits without the empty row', async () => {
    captureHits = [{ id: 'c1', caseId: 'case1', title: 'Kestrel page', url: 'https://k.test' }]
    noteHits = [{ id: 'n1', caseId: 'case1', title: 'Kestrel note', body: 'seen twice' }]
    renderBar()
    type('kestrel')

    expect(await screen.findByText('Kestrel page')).toBeTruthy()
    expect(screen.getByText('Kestrel note')).toBeTruthy()
    expect(screen.queryByText('No matches in this case')).toBeNull()
  })

  it('stays closed for a blank query', () => {
    renderBar()
    type('   ')
    expect(screen.queryByTestId('global-search-results')).toBeNull()
  })

  it('closes and drops the pending search when cleared', async () => {
    renderBar()
    type('kestrel')
    fireEvent.click(screen.getByLabelText('Clear search'))

    expect(screen.queryByTestId('global-search-results')).toBeNull()
    expect((screen.getByTestId('global-search-input') as HTMLInputElement).value).toBe('')
  })
})
