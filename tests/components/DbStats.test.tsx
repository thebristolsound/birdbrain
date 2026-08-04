// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DbStats } from '@renderer/components/settings/db/DbStats'
import { fakeBridge } from '../renderer/fakeBridge'

const stats = {
  fileSizeBytes: 2048,
  pageCount: 2,
  pageSize: 1024,
  freeListPages: 0,
  walSizeBytes: 0,
  tables: [{ name: 'cases', rowCount: 3 }]
}

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function renderStats() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<DbStats />, { wrapper: withClient(client) })
}

afterEach(() => {
  cleanup()
})

describe('DbStats', () => {
  it('keeps the loaded stats on screen when a background refetch fails', async () => {
    const statsFn = vi.fn()
    statsFn.mockResolvedValueOnce(stats)
    statsFn.mockRejectedValueOnce(new Error('stats unavailable'))
    fakeBridge({ db: { stats: statsFn } })

    const { container } = renderStats()

    expect(await screen.findByText('Database Statistics')).toBeDefined()

    const refresh = container.querySelector('svg.lucide-refresh-cw')?.closest('button')
    expect(refresh).toBeTruthy()
    fireEvent.click(refresh!)

    // The refetch rejects, but useQuery keeps the last good data — the stats
    // view must not be replaced by the error box.
    await waitFor(() => expect(statsFn).toHaveBeenCalledTimes(2))
    expect(screen.getByText('Database Statistics')).toBeDefined()
    expect(screen.queryByText('stats unavailable')).toBeNull()
  })

  it('shows the error when the first load fails and there is nothing to keep', async () => {
    fakeBridge({ db: { stats: vi.fn().mockRejectedValue(new Error('stats unavailable')) } })

    renderStats()

    expect(await screen.findByText('stats unavailable')).toBeDefined()
    expect(screen.queryByText('Database Statistics')).toBeNull()
  })
})
