// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ArchiveTab } from '@renderer/components/captures/ArchiveTab'
import type { Capture } from '@shared/types'

const capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/',
  title: 'Example',
  hash: 'h',
  timestamp: '2020-01-15T12:00:00.000Z',
  createdAt: '2020-01-15T12:00:01.000Z',
  format: 'mhtml',
  method: 'extension'
} as Capture

interface BirdbrainStub {
  archive: {
    lookup: ReturnType<typeof vi.fn>
    list: ReturnType<typeof vi.fn>
    pin: ReturnType<typeof vi.fn>
    unpin: ReturnType<typeof vi.fn>
  }
  captures: { openExternal: ReturnType<typeof vi.fn> }
}

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<ArchiveTab capture={capture} />, { wrapper: withClient(client) })
}

beforeEach(() => {
  ;(window as unknown as { birdbrain: BirdbrainStub }).birdbrain = {
    archive: {
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
    },
    captures: { openExternal: vi.fn().mockResolvedValue(undefined) }
  }
})

afterEach(() => {
  cleanup()
})

describe('ArchiveTab', () => {
  it('shows the look-up button initially and does not auto-query', () => {
    renderTab()
    expect(screen.getByTestId('archive-lookup-btn')).toBeDefined()
    expect(window.birdbrain.archive.lookup).not.toHaveBeenCalled()
  })

  it('runs the lookup on click and renders snapshots', async () => {
    renderTab()
    fireEvent.click(screen.getByTestId('archive-lookup-btn'))
    await waitFor(() => expect(window.birdbrain.archive.lookup).toHaveBeenCalledWith('cap1'))
    expect(await screen.findByTestId('archive-snapshot-row')).toBeDefined()
  })

  it('renders an empty state when no snapshots are found', async () => {
    ;(window.birdbrain.archive.lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      snapshots: [],
      closestIndex: null,
      checkedAt: '2026-06-30T00:00:00.000Z'
    })
    renderTab()
    fireEvent.click(screen.getByTestId('archive-lookup-btn'))
    expect(await screen.findByTestId('archive-empty')).toBeDefined()
  })

  it('shows the error state when the lookup rejects', async () => {
    ;(window.birdbrain.archive.lookup as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom')
    )
    renderTab()
    fireEvent.click(screen.getByTestId('archive-lookup-btn'))
    expect(await screen.findByTestId('archive-error')).toBeDefined()
  })

  it('renders pinned snapshots from the pins list', async () => {
    ;(window.birdbrain.archive.list as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
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

  it('shows the loading indicator while a lookup is in flight', async () => {
    let resolveLookup: (value: unknown) => void = () => {}
    const pending = new Promise((resolve) => {
      resolveLookup = resolve
    })
    ;(window.birdbrain.archive.lookup as ReturnType<typeof vi.fn>).mockReturnValueOnce(pending)
    renderTab()
    fireEvent.click(screen.getByTestId('archive-lookup-btn'))
    expect(await screen.findByTestId('archive-loading')).toBeDefined()
    resolveLookup({ snapshots: [], closestIndex: null, checkedAt: '2026-06-30T00:00:00.000Z' })
    await waitFor(() => expect(screen.queryByTestId('archive-loading')).toBeNull())
  })
})
