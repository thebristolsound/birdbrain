// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { FieldHit, FieldSearchResult } from '@shared/types'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'

const navigate = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate
}))

import { SearchBar } from '@renderer/components/search/SearchBar'

let captureHits: Array<{
  id: string
  caseId: string
  title: string
  url: string
  hash: string
  exhibitCitation?: string
}>
let noteHits: Array<{ id: string; caseId: string; title: string; body: string }>
let fieldResult: FieldSearchResult
let captureSearchFails: boolean
let noteSearchFails: boolean

const EXHIBIT_ID = '3d1f6c2e-5b7a-4c9d-8e0f-1a2b3c4d5e6f'

function fieldHit(overrides: Partial<FieldHit>): FieldHit {
  return {
    fieldId: 1,
    caseId: 'case1',
    exhibitId: EXHIBIT_ID,
    exhibitNumber: 7,
    exhibitCitation: '7',
    contentHash: 'ab12cd34ef56'.padEnd(64, '0'),
    title: 'Quillmere notice',
    field: 'link.href',
    preview: 'https://tollgate-ledger.example.com/pay',
    norm: 'https://tollgate-ledger.example.com/pay',
    occurrences: 1,
    locator: { source: 'html-part', part: 0, startOffset: 9, endOffset: 48, extractor: 'fields/1' },
    ...overrides
  }
}

// The IPC layer rejects when full-text search cannot parse the text (a domain,
// an email address), rather than returning an empty list.
function failedSearch(): Promise<never> {
  return Promise.reject(new Error('Search could not run'))
}

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
  fieldResult = { hits: [], unavailable: [], truncated: false }
  captureSearchFails = false
  noteSearchFails = false
  navigate.mockClear()
  useAppStore.setState({ viewerHit: null, activeViewerTab: 'screenshot', selectedCaptureId: null })
  fakeBridge({
    search: vi.fn(() => (captureSearchFails ? failedSearch() : Promise.resolve(captureHits))),
    notes: {
      search: vi.fn(() => (noteSearchFails ? failedSearch() : Promise.resolve(noteHits)))
    },
    cases: { searchFields: vi.fn(() => Promise.resolve(fieldResult)) }
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

  it('says the search could not run, not that nothing matched, when it fails', async () => {
    captureSearchFails = true
    noteSearchFails = true
    renderBar()
    type('example.com')

    expect(await screen.findByText('Search could not run on this text')).toBeTruthy()
    expect(screen.queryByText('No matches in this case')).toBeNull()
  })

  it('withholds the empty row when only the note search failed', async () => {
    noteSearchFails = true
    renderBar()
    type('kestrel')

    expect(await screen.findByText('Search could not run on this text')).toBeTruthy()
    expect(screen.queryByText('No matches in this case')).toBeNull()
  })

  it('lists capture and note hits without the empty row', async () => {
    captureHits = [
      {
        id: 'c1',
        caseId: 'case1',
        title: 'Kestrel page',
        url: 'https://k.test',
        hash: 'f00dfeed1234'.padEnd(64, '9'),
        exhibitCitation: '3'
      }
    ]
    noteHits = [{ id: 'n1', caseId: 'case1', title: 'Kestrel note', body: 'seen twice' }]
    renderBar()
    type('kestrel')

    expect(await screen.findByText('Kestrel page')).toBeTruthy()
    expect(screen.getByText('Kestrel note')).toBeTruthy()
    expect(screen.queryByText('No matches in this case')).toBeNull()
    expect(screen.getByTitle('Exhibit Number').textContent).toBe('3')
    expect(screen.getByTitle('Content Hash').textContent).toBe('f00dfeed1234')
  })

  it('lists link and header hits under their field, with the Exhibit and Content Hash', async () => {
    fieldResult = {
      hits: [
        fieldHit({ fieldId: 1, occurrences: 3 }),
        fieldHit({
          fieldId: 2,
          field: 'header.from',
          preview: 'Wren Hollis <wren@hollis-mail.example.org>',
          locator: {
            source: 'text',
            part: null,
            startOffset: 20,
            endOffset: 62,
            extractor: 'fields/1'
          }
        }),
        fieldHit({ fieldId: 3, preview: 'https://tollgate-ledger.example.com/refund' })
      ],
      unavailable: [],
      truncated: false
    }
    renderBar()
    type('tollgate')

    await screen.findByText('Wren Hollis <wren@hollis-mail.example.org>')
    const groups = screen.getAllByTestId('global-search-field-group')
    expect(groups.map((g) => g.firstElementChild?.textContent)).toEqual([
      'Link target',
      'From header'
    ])
    expect(groups[0].querySelectorAll('button')).toHaveLength(2)
    expect(groups[0].textContent).toContain('×3')
    expect(groups[1].textContent).toContain('ab12cd34ef56')
    expect(groups[1].textContent).not.toContain('ab12cd34ef560')
    expect(screen.queryByText('No matches in this case')).toBeNull()
  })

  it('opens a header hit in the Text tab and a link hit in the Links tab', async () => {
    const header = fieldHit({
      fieldId: 2,
      field: 'header.reply-to',
      preview: 'billing@tollgate-ledger.example.com',
      locator: { source: 'text', part: null, startOffset: 5, endOffset: 40, extractor: 'fields/1' }
    })
    fieldResult = { hits: [fieldHit({ fieldId: 1 }), header], unavailable: [], truncated: false }
    renderBar()
    type('tollgate')

    fireEvent.click(await screen.findByText('billing@tollgate-ledger.example.com'))
    expect(useAppStore.getState()).toMatchObject({
      selectedCaptureId: EXHIBIT_ID,
      activeViewerTab: 'text',
      viewerHit: header
    })
    expect(navigate).toHaveBeenCalledWith({
      to: '/cases/$caseId/captures',
      params: { caseId: 'case1' }
    })
    expect(screen.queryByTestId('global-search-results')).toBeNull()

    type('tollgate')
    fireEvent.click(await screen.findByText('https://tollgate-ledger.example.com/pay'))
    expect(useAppStore.getState().activeViewerTab).toBe('links')
    expect(useAppStore.getState().viewerHit?.fieldId).toBe(1)
  })

  it('drops an opened search hit when a capture result is opened', async () => {
    useAppStore.setState({ viewerHit: fieldHit({}) })
    captureHits = [
      {
        id: 'c1',
        caseId: 'case1',
        title: 'Kestrel page',
        url: 'https://k.test',
        hash: 'a'.repeat(64)
      }
    ]
    renderBar()
    type('kestrel')

    fireEvent.click(await screen.findByText('Kestrel page'))
    expect(useAppStore.getState().viewerHit).toBeNull()
  })

  it('names the Exhibits whose records changed after they were indexed', async () => {
    fieldResult = {
      hits: [],
      unavailable: [
        { exhibitId: EXHIBIT_ID, exhibitCitation: '7' },
        { exhibitId: 'other', exhibitCitation: 'NK-12' }
      ],
      truncated: false
    }
    renderBar()
    type('tollgate')

    expect((await screen.findByTestId('global-search-unavailable')).textContent).toBe(
      'Link and header matches unavailable, changed after indexing: Exhibit 7, NK-12'
    )
    expect(screen.queryByText('No matches in this case')).toBeNull()
  })

  it('says when the link and header hits were cut short', async () => {
    fieldResult = { hits: [fieldHit({})], unavailable: [], truncated: true }
    renderBar()
    type('tollgate')

    expect(
      await screen.findByText('Only the first 1 link and header matches are listed.')
    ).toBeTruthy()
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
