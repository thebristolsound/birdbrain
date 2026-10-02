// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

// Hoisted: the factories run while IndicatorsView's import graph is still
// loading, which is before a plain top-level const would be initialised.
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

import { IndicatorsView } from '@renderer/components/data/IndicatorsView'
import { fakeBridge } from '../renderer/fakeBridge'

const SOURCE_URL = 'https://example.com/dump/1'

let openExternal: ReturnType<typeof vi.fn>
// Held so the assertion can be on identity: the handler must pass the original
// rejection through as `cause`, not a rewrapped stand-in.
let cause: Error

function renderExplorer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<Harness />, { wrapper: Wrapper })
}

// The rail owns the selection on the Data screen; this stands in for it.
function Harness() {
  const [pick, setPick] = useState<{ category: string | null; subcategory: string | null }>({
    category: null,
    subcategory: null
  })
  return (
    <>
      <button type="button" onClick={() => setPick({ category: 'emails', subcategory: null })}>
        Rail pick
      </button>
      <IndicatorsView
        caseId="case1"
        category={pick.category}
        subcategory={pick.subcategory}
        onSelect={(category, subcategory) => setPick({ category, subcategory })}
      />
    </>
  )
}

// Walks the three-column browse path to the item row that carries the source
// URL button: category -> subcategory -> item.
async function openSourceUrl() {
  fireEvent.click(await screen.findByText('emails'))
  fireEvent.click(await screen.findByText('personal'))
  fireEvent.click(await screen.findByText(SOURCE_URL))
}

beforeEach(() => {
  cause = new Error('EACCES')
  openExternal = vi.fn(async () => {
    throw cause
  })
  fakeBridge({
    extractedData: {
      categories: vi.fn(async () => [{ category: 'emails', count: 1 }]),
      subcategories: vi.fn(async () => [{ subcategory: 'personal', count: 1 }]),
      items: vi.fn(async () => [
        { value: 'someone@example.com', pageCount: 1, sourceUrls: [SOURCE_URL] }
      ]),
      count: vi.fn(async () => 1),
      search: vi.fn(async () => [])
    },
    captures: { openExternal }
  })
})

afterEach(() => {
  cleanup()
  notifyError.mockReset()
})

// The IOC browser that was the whole Data screen before #1149; these tests
// moved with it and cover the same behaviour under its new name.
describe('IndicatorsView', () => {
  it('reports a failed shell launch when an extracted source URL cannot be opened', async () => {
    renderExplorer()

    await openSourceUrl()

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    expect(openExternal).toHaveBeenCalledWith(SOURCE_URL)
    const [message, opts] = notifyError.mock.calls[0]
    // Exact match, not a substring: the source URL names a page under
    // investigation, and a fixed literal with nothing interpolated into it is
    // what keeps it out of the durable log. A message that grew the URL would
    // fail here.
    expect(message).toBe("Couldn't open the link in your browser")
    expect(opts.cause).toBe(cause)
  })

  it('says nothing when the source URL opens successfully', async () => {
    openExternal.mockResolvedValue(undefined)
    renderExplorer()

    await openSourceUrl()

    await waitFor(() => expect(openExternal).toHaveBeenCalledOnce())
    expect(notifyError).not.toHaveBeenCalled()
  })

  // 'capture', not 'manual': the search results are the only place
  // CreateSelectorPopover is mounted, and the value it seeds was extracted out
  // of a capture rather than typed by the operator (#395).
  it('stamps a selector made from an extracted indicator as coming from a capture', async () => {
    const create = vi.fn(async () => ({ id: 's1' }))
    fakeBridge({
      extractedData: {
        categories: vi.fn(async () => [{ category: 'emails', count: 1 }]),
        subcategories: vi.fn(async () => [{ subcategory: 'personal', count: 1 }]),
        items: vi.fn(async () => []),
        count: vi.fn(async () => 1),
        search: vi.fn(async () => [
          {
            category: 'emails',
            subcategory: 'personal',
            value: 'someone@example.com',
            pageCount: 1,
            sourceUrls: [SOURCE_URL]
          }
        ])
      },
      selectors: { create }
    })
    renderExplorer()

    // The query input is debounced by 250ms, so the result row arrives a beat
    // after the change event.
    fireEvent.change(await screen.findByPlaceholderText('Search indicators...'), {
      target: { value: 'someone' }
    })
    fireEvent.click(await screen.findByTitle('Create selector from this indicator'))
    fireEvent.click(await screen.findByText('Create'))

    await waitFor(() => expect(create).toHaveBeenCalledOnce())
    expect(create).toHaveBeenCalledWith({
      caseId: 'case1',
      pattern: 'someone@example.com',
      isRegex: false,
      label: 'personal',
      origin: 'capture'
    })
  })

  it('leaves search mode when the rail picks a category, so the pick shows', async () => {
    renderExplorer()
    const input = (await screen.findByPlaceholderText('Search indicators...')) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'someone' } })
    expect(await screen.findByText(/No indicators match/)).toBeTruthy()

    fireEvent.click(screen.getByText('Rail pick'))

    expect(await screen.findByText('personal')).toBeTruthy()
    expect(input.value).toBe('')
    expect(screen.queryByText(/No indicators match/)).toBeNull()
  })

  it('runs the whole-case reprocess from its header and refreshes', async () => {
    const reprocess = vi.fn(async () => ({ processed: 2 }))
    fakeBridge({
      extractedData: {
        categories: vi.fn(async () => [{ category: 'emails', count: 1 }]),
        subcategories: vi.fn(async () => []),
        items: vi.fn(async () => []),
        count: vi.fn(async () => 1),
        search: vi.fn(async () => []),
        reprocess
      }
    })
    renderExplorer()
    fireEvent.click(await screen.findByRole('button', { name: /Reprocess/ }))
    await waitFor(() => expect(reprocess).toHaveBeenCalledWith('case1'))
  })

  it('explains the empty state when nothing has been extracted', async () => {
    fakeBridge({
      extractedData: {
        categories: vi.fn(async () => []),
        subcategories: vi.fn(async () => []),
        items: vi.fn(async () => []),
        count: vi.fn(async () => 0),
        search: vi.fn(async () => [])
      }
    })
    renderExplorer()
    expect(await screen.findByText('No data extracted yet')).toBeTruthy()
    expect(screen.getByText('No extracted data yet')).toBeTruthy()
  })
})
