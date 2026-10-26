import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SyncPill } from '@renderer/components/status/SyncPill'
import { queryKeys } from '@renderer/lib/api/keys'
import { fakeBridge } from '../renderer/fakeBridge'
import { sync } from './sharingFixtures'
import type { SyncState } from '@shared/types'

afterEach(cleanup)

function setup(state: SyncState) {
  fakeBridge({ sharing: { getSyncState: vi.fn(async () => state) } })
  const onOpenMembers = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SyncPill caseId="case-1" onOpenMembers={onOpenMembers} />
    </QueryClientProvider>
  )
  return { onOpenMembers, client }
}

describe('SyncPill', () => {
  it('opens Members and explains the network glyph', async () => {
    const { onOpenMembers } = setup(sync({ egress: 'tor' }))
    const pill = await screen.findByTestId('sync-pill')
    expect(
      screen.getByLabelText('Network addresses visible to teammates and the relay')
    ).toBeTruthy()
    expect(screen.getByRole('tooltip').textContent).toContain('including a system VPN’s own')
    fireEvent.click(pill)
    expect(onOpenMembers).toHaveBeenCalledOnce()
  })

  it('tints a newer-version pause', async () => {
    setup(
      sync({
        phase: 'error',
        lastError: { kind: 'newer-version', at: '2026-01-01T00:00:00Z' }
      })
    )
    expect((await screen.findByTestId('sync-pill')).dataset.chrome).toBe('error')
    expect(screen.getByText('Sync paused · newer version')).toBeTruthy()
  })

  it('hides for a Case with no peers', async () => {
    const state = sync({ peersTotal: 0, peersReachable: 0, peers: [] })
    const { client } = setup(state)
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.sharingSyncState('case-1'))?.status).toBe('success')
    )
    expect(screen.queryByTestId('sync-pill')).toBeNull()
  })
})
