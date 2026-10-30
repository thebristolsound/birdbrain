import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SharePill } from '@renderer/components/status/SharePill'
import { queryKeys } from '@renderer/lib/api/keys'
import { useAppStore } from '@renderer/stores/appStore'
import { fakeBridge } from '../renderer/fakeBridge'
import { AR, JO, members, sync } from './sharingFixtures'
import type { SharingMembers, SyncState } from '@shared/types'

afterEach(cleanup)

interface Reads {
  available?: boolean
  roster?: SharingMembers | Promise<SharingMembers>
  syncState?: SyncState | Promise<SyncState>
}

// A Case nobody has shared lists no members, and a Case with only its Owner
// has no peer to sync with.
const LOCAL = members({ members: [], invites: [], pendingJoins: [] })
const OWNER_ONLY = members({ members: [AR] })
const NO_PEERS = sync({ peersTotal: 0, peersReachable: 0, peers: [] })
const NEVER = new Promise<never>(() => {})

function setup({ available = true, roster = members(), syncState = sync() }: Reads = {}) {
  const getSyncState = vi.fn(async () => syncState)
  fakeBridge({
    sharing: {
      isAvailable: vi.fn(async () => available),
      getMembers: vi.fn(async () => roster),
      getSyncState
    }
  })
  const onOpenMembers = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <SharePill caseId="case-1" onOpenMembers={onOpenMembers} />
    </QueryClientProvider>
  )
  return { onOpenMembers, client, getSyncState }
}

describe('SharePill', () => {
  it('is the sync pill once a peer is on the roster, with the network glyph', async () => {
    const { onOpenMembers } = setup({ syncState: sync({ egress: 'tor' }) })
    const pill = await screen.findByTestId('share-pill')
    expect(pill.dataset.state).toBe('synced')
    expect(screen.getByText('Synced · 1 of 3 peers')).toBeTruthy()
    expect(
      screen.getByLabelText('Network addresses visible to teammates and the relay')
    ).toBeTruthy()
    expect(screen.getByRole('tooltip').textContent).toContain('including a system VPN’s own')
    fireEvent.click(pill)
    expect(onOpenMembers).toHaveBeenCalledOnce()
  })

  it('tints a newer-version pause', async () => {
    setup({
      syncState: sync({
        phase: 'error',
        lastError: { kind: 'newer-version', at: '2026-01-01T00:00:00Z' }
      })
    })
    const pill = await screen.findByTestId('share-pill')
    expect(pill.className).toContain('text-danger-fg')
    expect(pill.querySelector('.bg-danger-fg')).not.toBeNull()
    expect(screen.getByText('Sync paused · newer version')).toBeTruthy()
  })

  it('offers Share on a Case nobody has shared, without polling its sync state', async () => {
    const { onOpenMembers, getSyncState } = setup({ roster: LOCAL })
    const pill = await screen.findByTestId('share-pill')
    expect(pill.dataset.state).toBe('share')
    expect(pill.textContent).toBe('Share')
    expect(pill.title).toBe('Early access. Share this Case with teammates. Opens Members.')
    expect(pill.dataset.tour).toBe('share')
    expect(pill.querySelector('.bg-warning-fg')).toBeNull()
    expect(getSyncState).not.toHaveBeenCalled()
    fireEvent.click(pill)
    expect(onOpenMembers).toHaveBeenCalledOnce()
  })

  it('waits on an open invite with a pulsing dot and the expiry in its tooltip', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString()
    setup({
      roster: members({ members: [AR], invites: [{ inviteId: 'inv-1', expiresAt }] }),
      syncState: NO_PEERS
    })
    const pill = await screen.findByTestId('share-pill')
    expect(pill.dataset.state).toBe('invite')
    expect(pill.textContent).toBe('Share · invite waiting')
    expect(pill.title).toMatch(/^Early access\. Invite expires (today|tomorrow) \d\d:\d\d$/)
    // One dot in the icon's corner for the folded form, one inline for the wide form.
    expect(pill.querySelectorAll('.bg-warning-fg.animate-pulse')).toHaveLength(2)
  })

  it('counts the join requests waiting for approval, with a still dot', async () => {
    setup({ roster: members({ members: [AR], pendingJoins: [JO] }), syncState: NO_PEERS })
    const pill = await screen.findByTestId('share-pill')
    expect(pill.dataset.state).toBe('approve')
    expect(pill.textContent).toBe('Share · 1 to approve')
    expect(pill.title).toBe('Early access. 1 join request to approve')
    expect(pill.querySelector('.animate-pulse')).toBeNull()
  })

  it('draws the dashed form where sharing is unavailable', async () => {
    setup({ available: false, roster: LOCAL })
    const pill = await screen.findByTestId('share-pill')
    expect(pill.dataset.state).toBe('unavailable')
    expect(pill.textContent).toBe('Share')
    expect(pill.title).toBe('Early access. Sharing is not available on this Mac.')
    expect(pill.className).toContain('border-dashed')
  })

  it('shows nothing until the roster has loaded', async () => {
    const { client } = setup({ roster: NEVER })
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.sharingAvailable)?.status).toBe('success')
    )
    expect(screen.queryByTestId('share-pill')).toBeNull()
  })

  it('never reads Share on its way to Synced: peers wait for the first sync state', async () => {
    const { client } = setup({ syncState: NEVER })
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.sharingMembers('case-1'))?.status).toBe('success')
    )
    expect(screen.queryByTestId('share-pill')).toBeNull()
  })

  it('wears a ring while the Share mark shows', async () => {
    useAppStore.setState({ shareMarkOpen: true })
    try {
      setup({ roster: LOCAL })
      const pill = await screen.findByTestId('share-pill')
      expect(pill.dataset.marked).toBe('true')
      expect(pill.className).toContain('ring-[3px]')
    } finally {
      useAppStore.setState({ shareMarkOpen: false })
    }
  })

  it('falls back to Share once the Owner is alone on the roster', async () => {
    setup({ roster: OWNER_ONLY, syncState: NO_PEERS })
    const pill = await screen.findByTestId('share-pill')
    expect(pill.dataset.state).toBe('share')
  })
})
