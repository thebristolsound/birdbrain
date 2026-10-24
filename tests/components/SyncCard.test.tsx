// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SharingErrorCode, SyncState } from '@shared/types'
import { SyncCard } from '@renderer/components/sharing/SyncCard'
import { fakeBridge } from '../renderer/fakeBridge'
import { CASE_ID, members, peer, refusal, snapshot, sync } from './sharingFixtures'

const NOW = new Date('2026-09-19T14:05:00.000Z').getTime()

let syncNow: ReturnType<typeof vi.fn>
let onRefusal: Mock<(code: SharingErrorCode | null) => void>
let onResolved: Mock<() => void>

function renderCard(state: SyncState | undefined, withSnapshot = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(
    <SyncCard
      caseId={CASE_ID}
      members={members()}
      syncState={state}
      snapshot={withSnapshot ? snapshot() : undefined}
      nowMs={NOW}
      onRefusal={onRefusal}
      onResolved={onResolved}
    />,
    { wrapper: Wrapper }
  )
}

beforeEach(() => {
  syncNow = vi.fn(async () => [])
  onRefusal = vi.fn()
  onResolved = vi.fn()
  fakeBridge({ sharing: { syncNow } })
})

afterEach(cleanup)

describe('SyncCard', () => {
  it('shows the spinner line and disables Sync now while a round runs', () => {
    renderCard(
      sync({
        phase: 'syncing',
        peersReachable: 2,
        peers: [peer('inst-nk', { reachable: true }), peer('inst-mb', { reachable: true })]
      })
    )
    expect(screen.getByTestId('sync-spinner')).toBeTruthy()
    expect(screen.getByText('Syncing with N. Kowalski, M. Brandt')).toBeTruthy()
    expect(screen.getByText('2 of 3 peers connected')).toBeTruthy()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Sync now' })
    expect(button.hasAttribute('disabled')).toBe(true)
  })

  it('reads Synced when idle and runs a round from Sync now', async () => {
    renderCard(sync())
    expect(screen.getByText('Synced · 1 of 3 peers connected')).toBeTruthy()
    expect(screen.queryByTestId('sync-spinner')).toBeNull()
    const button = screen.getByRole('button', { name: 'Sync now' })
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(syncNow).toHaveBeenCalledWith(CASE_ID))
    await waitFor(() => expect(onResolved).toHaveBeenCalled())
  })

  it('reads the pill label in danger when the last round failed', () => {
    renderCard(sync({ phase: 'error', lastError: { kind: 'relay', at: '2026-09-19T14:00:00Z' } }))
    const line = screen.getByText('Sync failed · relay')
    expect(line.className).toContain('text-danger-fg')
  })

  it('names a newer-version pause as paused, not failed', () => {
    renderCard(
      sync({
        phase: 'error',
        lastError: { kind: 'newer-version', at: '2026-09-19T14:00:00Z', installationId: 'inst-si' }
      })
    )
    expect(screen.getByText('Sync paused · newer version')).toBeTruthy()
  })

  it('footers the last completed sync and the latest merge from the chain', () => {
    renderCard(sync({ lastSuccessAt: '2026-09-19T14:02:11.000Z' }), true)
    expect(screen.getByTestId('sync-footer').textContent).toBe(
      'Last completed sync today 14:02 · received 4 entries from NK · Manifest entry merge #0031'
    )
  })

  it('drops the footer clauses it has no source for', () => {
    renderCard(sync(), true)
    expect(screen.getByTestId('sync-footer').textContent).toBe(
      'received 4 entries from NK · Manifest entry merge #0031'
    )
    cleanup()
    renderCard(sync())
    expect(screen.queryByTestId('sync-footer')).toBeNull()
  })

  it('reports a relay-unreachable refusal to the tab', async () => {
    syncNow.mockRejectedValue(refusal('relay-unreachable'))
    renderCard(sync())
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(onRefusal).toHaveBeenCalledWith('relay-unreachable'))
    expect(onResolved).not.toHaveBeenCalled()
  })
})
