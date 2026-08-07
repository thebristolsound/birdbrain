// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { WaybackTab } from '@renderer/components/captures/WaybackTab'
import type { Capture } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'

// Hoisted: the mock factory runs while WaybackTab's import graph is still
// loading, which is before a plain top-level const would be initialised.
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/',
  title: 'Example',
  hash: 'h',
  timestamp: '2020-01-15T12:00:00.000Z',
  createdAt: '2020-01-15T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
}

let wayback: Record<string, ReturnType<typeof vi.fn>>

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<WaybackTab capture={capture} />, { wrapper: withClient(client) })
}

beforeEach(() => {
  wayback = {
    lookup: vi.fn().mockResolvedValue({
      snapshots: [
        {
          timestamp: '2020-01-14T00:00:00.000Z',
          snapshotUrl: 'https://web.archive.org/web/20200114000000/https://example.com/',
          originalUrl: 'https://example.com/',
          statusCode: 200,
          mimeType: 'text/html'
        }
      ],
      closestIndex: 0,
      checkedAt: '2026-06-30T00:00:00.000Z'
    }),
    list: vi.fn().mockResolvedValue([]),
    pin: vi.fn().mockResolvedValue({ id: 'ref1' }),
    unpin: vi.fn().mockResolvedValue(true)
  }
  fakeBridge({
    wayback,
    captures: { openExternal: vi.fn().mockResolvedValue(undefined) }
  })
})

afterEach(() => {
  cleanup()
  notifyError.mockReset()
})

describe('WaybackTab', () => {
  it('shows the look-up button initially and does not auto-query', () => {
    renderTab()
    expect(screen.getByTestId('wayback-lookup-btn')).toBeDefined()
    expect(wayback.lookup).not.toHaveBeenCalled()
  })

  it('runs the lookup on click and renders snapshots', async () => {
    renderTab()
    fireEvent.click(screen.getByTestId('wayback-lookup-btn'))
    await waitFor(() => expect(wayback.lookup).toHaveBeenCalledWith('cap1'))
    expect(await screen.findByTestId('wayback-snapshot-row')).toBeDefined()
  })

  it('renders an empty state when no snapshots are found', async () => {
    wayback.lookup.mockResolvedValueOnce({
      snapshots: [],
      closestIndex: null,
      checkedAt: '2026-06-30T00:00:00.000Z'
    })
    renderTab()
    fireEvent.click(screen.getByTestId('wayback-lookup-btn'))
    expect(await screen.findByTestId('wayback-empty')).toBeDefined()
  })

  it('shows the error state when the lookup rejects', async () => {
    wayback.lookup.mockRejectedValueOnce(new Error('boom'))
    renderTab()
    fireEvent.click(screen.getByTestId('wayback-lookup-btn'))
    expect(await screen.findByTestId('wayback-error')).toBeDefined()
  })

  it('renders pinned snapshots from the pins list', async () => {
    wayback.list.mockResolvedValueOnce([
      {
        id: 'ref1',
        captureId: 'cap1',
        snapshotTimestamp: '2020-01-14T00:00:00.000Z',
        snapshotUrl: 'https://web.archive.org/web/20200114000000/https://example.com/',
        originalUrl: 'https://example.com/',
        checkedAt: '2026-06-30T00:00:00.000Z',
        pinnedAt: '2026-06-30T00:01:00.000Z',
        statusCode: 200
      }
    ])
    renderTab()
    expect(await screen.findByText('Pinned')).toBeDefined()
  })

  it('reports a failed shell launch when a pinned snapshot cannot be opened', async () => {
    const openExternal = vi.fn(async () => {
      throw new Error('EACCES')
    })
    wayback.list.mockResolvedValueOnce([
      {
        id: 'ref1',
        captureId: 'cap1',
        snapshotTimestamp: '2020-01-14T00:00:00.000Z',
        snapshotUrl: 'https://web.archive.org/web/20200114000000/https://example.com/',
        originalUrl: 'https://example.com/',
        checkedAt: '2026-06-30T00:00:00.000Z',
        pinnedAt: '2026-06-30T00:01:00.000Z',
        statusCode: 200
      }
    ])
    fakeBridge({ wayback, captures: { openExternal } })

    renderTab()

    fireEvent.click(await screen.findByLabelText('Open snapshot'))

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    const [message, opts] = notifyError.mock.calls[0]
    expect(message).toBe("Couldn't open the link in your browser")
    expect(opts.cause).toBeInstanceOf(Error)
    // The snapshot URL restates the capture's URL; keep it out of the message.
    expect(message).not.toContain('archive.org')
  })

  it('shows the loading indicator while a lookup is in flight', async () => {
    let resolveLookup: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      resolveLookup = resolve
    })
    wayback.lookup.mockReturnValueOnce(pending)
    renderTab()
    fireEvent.click(screen.getByTestId('wayback-lookup-btn'))
    expect(await screen.findByTestId('wayback-loading')).toBeDefined()
    resolveLookup({ snapshots: [], closestIndex: null, checkedAt: '2026-06-30T00:00:00.000Z' })
    await waitFor(() => expect(screen.queryByTestId('wayback-loading')).toBeNull())
  })
})
