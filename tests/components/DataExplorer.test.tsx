// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// Hoisted: the factories run while DataExplorer's import graph is still
// loading, which is before a plain top-level const would be initialised.
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ caseId: 'case1' })
}))

import { DataExplorer } from '@renderer/components/dashboard/cases/DataExplorer'
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
  return render(<DataExplorer />, { wrapper: Wrapper })
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

describe('DataExplorer', () => {
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
})
