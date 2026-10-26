// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type {
  BirdbrainSettings,
  SharingMembers,
  SharingSyncOutcome,
  SyncState
} from '@shared/types'
import { MembersTab } from '@renderer/components/sharing/MembersTab'
import { fakeBridge } from '../renderer/fakeBridge'
import {
  CASE_ID,
  JO,
  exhibitRow,
  members,
  peer,
  refusal,
  settings,
  snapshot,
  sync
} from './sharingFixtures'

interface Setup {
  available?: boolean
  roster?: SharingMembers
  state?: SyncState
  prefs?: BirdbrainSettings
}

let bridge: {
  createInvite: ReturnType<typeof vi.fn>
  syncNow: ReturnType<typeof vi.fn>
  revoke: ReturnType<typeof vi.fn>
  exportArchive: ReturnType<typeof vi.fn>
  check: ReturnType<typeof vi.fn>
}

function setup({
  available = true,
  roster = members(),
  state = sync(),
  prefs = settings()
}: Setup) {
  bridge = {
    createInvite: vi.fn(async () => ({ inviteId: 'inv-1', invite: 'bbinvite1x', expiresAt: '' })),
    syncNow: vi.fn(async () => [
      {
        installationId: 'inst-nk',
        outcome: 'synced',
        entries: 0,
        blobs: 0,
        rowsApplied: 0,
        errors: 0
      }
    ]),
    revoke: vi.fn(async () => ({})),
    exportArchive: vi.fn(async () => ({})),
    check: vi.fn(async () => ({ phase: 'idle' }))
  }
  fakeBridge({
    sharing: {
      isAvailable: vi.fn(async () => available),
      getMembers: vi.fn(async () => roster),
      getSyncState: vi.fn(async () => state),
      createInvite: bridge.createInvite,
      syncNow: bridge.syncNow,
      revoke: bridge.revoke,
      setRelayUrl: vi.fn(async () => undefined)
    },
    settings: { get: vi.fn(async () => prefs) },
    manifest: { snapshot: vi.fn(async () => snapshot()) },
    exhibits: {
      inventory: vi.fn(async () => ({ caseId: CASE_ID, rows: [exhibitRow('NK-1', 1)] }))
    },
    cases: {
      exportArchive: bridge.exportArchive,
      get: vi.fn(async () => ({ id: CASE_ID, name: 'Operation Nightjar' }))
    },
    updates: { check: bridge.check }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<MembersTab caseId={CASE_ID} />, { wrapper: Wrapper })
}

async function row(key: string) {
  return screen.findByTestId(`member-row-${key}`)
}

function connection(rowEl: HTMLElement) {
  const cell = within(rowEl).getByTestId('member-connection')
  return { text: cell.textContent, tone: cell.dataset.tone, dot: cell.dataset.dot }
}

function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString()
}

afterEach(cleanup)

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('the Members tab whole-tab states', () => {
  it('offers to share a Case nobody has shared, with the Owner code it would write', async () => {
    setup({ roster: members({ members: [] }) })
    const card = await screen.findByTestId('not-shared-card')
    expect(within(card).getByText('This Case is on this machine only')).toBeTruthy()
    expect(
      within(card).getByText(
        'Share it with up to four peers who run Birdbrain. Each keeps a full copy. Every ' +
          'Capture, note, and tag stays signed by the installation that made it, and Exhibit ' +
          'Numbers gain your Member Code (AR-7) so citations stay unique.'
      )
    ).toBeTruthy()
    expect(
      within(card).getByText('Peers connect to each other; no server holds the Case.')
    ).toBeTruthy()
    expect(within(card).getByText(/Your Member Code will be/).textContent).toBe(
      'Your Member Code will be AR'
    )
    fireEvent.click(within(card).getByRole('button', { name: 'Invite' }))
    await waitFor(() => expect(bridge.createInvite).toHaveBeenCalledWith(CASE_ID, 'AR'))
    expect(screen.queryByTestId('members-list')).toBeNull()
    // The first invite shares the Case; the dialog opens on the string.
    const dialog = await screen.findByTestId('invite-dialog')
    expect(dialog.dataset.step).toBe('created')
    expect(within(dialog).getByTestId('invite-string').textContent).toBe('bbinvite1x')
  })

  it('says an Operator name is needed when the first invite is refused for it', async () => {
    setup({ roster: members({ members: [] }), prefs: settings({ operatorName: '' }) })
    const card = await screen.findByTestId('not-shared-card')
    bridge.createInvite.mockRejectedValue(refusal('operator-name-required'))
    fireEvent.click(within(card).getByRole('button', { name: 'Invite' }))
    expect((await screen.findByTestId('invite-error')).textContent).toBe(
      'Set an Operator name in Settings first; invites carry it.'
    )
  })

  it('shows the unavailable card with an archive export and no Invite', async () => {
    setup({ available: false })
    const card = await screen.findByTestId('unavailable-card')
    expect(within(card).getByText('Sharing is not available on this Mac')).toBeTruthy()
    expect(
      within(card).getByText(
        'To work with a peer today, export a Case Archive and import it on their machine. That ' +
          'is a one-time copy, not a sync.'
      )
    ).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Invite' })).toBeNull()
    fireEvent.click(within(card).getByRole('button', { name: 'Export Case Archive…' }))
    await waitFor(() => expect(bridge.exportArchive).toHaveBeenCalledWith(CASE_ID))
  })

  it('shows the network notice whenever the Egress is not Direct', async () => {
    setup({
      prefs: settings({ egress: { kind: 'proxy', proxyUrl: 'socks5://h:1', label: '' } })
    })
    expect(await screen.findByTestId('network-notice')).toBeTruthy()
    expect(screen.getByText(/^Egress is set to Proxy\./)).toBeTruthy()
    cleanup()
    setup({})
    await screen.findByTestId('members-list')
    expect(screen.queryByTestId('network-notice')).toBeNull()
  })
})

describe('the identity card', () => {
  it('names this installation and unfolds the fingerprint on request', async () => {
    setup({})
    const card = await screen.findByTestId('identity-card')
    expect(within(card).getByText('A. Renner')).toBeTruthy()
    expect(within(card).getByText('Owner · Member Code AR')).toBeTruthy()
    const toggle = within(card).getByTestId('fingerprint-toggle')
    expect(toggle.title).toBe('Show full fingerprint')
    expect(toggle.textContent).toBe('9f3a 1c7e …')
    fireEvent.click(toggle)
    expect(toggle.textContent).toBe('9f3a 1c7e 44b2 08d1 e6a0 5b93 7c2f d418')
    expect(
      within(card).getByText(
        'A fingerprint identifies this installation’s signing key, not a person. Read it aloud to ' +
          'a peer over a channel you already trust if you want them to confirm it is you.'
      )
    ).toBeTruthy()
  })
})

describe('the members list', () => {
  it('counts the roster without the revoked and carries the footnote', async () => {
    setup({ roster: members({ pendingJoins: [JO] }) })
    expect((await screen.findByTestId('members-count')).textContent).toBe('Members · 4')
    expect(
      screen.getByText(
        'A member is an installation. One person on two machines appears twice, with two Member ' +
          'Codes. Staging Pool, Selectors, to-do items, and timestamp settings stay on each ' +
          'machine and are not synced.'
      )
    ).toBeTruthy()
  })

  it('draws self, connected, offline and revoked rows from the roster and the sync state', async () => {
    setup({
      state: sync({
        peers: [
          peer('inst-nk', { reachable: true, lastSessionAt: minutesAgo(2) }),
          peer('inst-mb', { lastSessionAt: minutesAgo(5) }),
          peer('inst-si')
        ]
      })
    })
    const self = await row('inst-ar')
    expect(within(self).getByText('Owner · you')).toBeTruthy()
    expect(connection(self)).toEqual({ text: 'This machine', tone: 'muted', dot: 'accent' })
    expect(within(self).queryByRole('button')).toBeNull()

    const nk = await row('inst-nk')
    expect(within(nk).getByText('N. Kowalski')).toBeTruthy()
    expect(within(nk).getByText('Member')).toBeTruthy()
    expect(connection(nk)).toEqual({ text: 'Connected', tone: 'success', dot: 'success' })
    expect(within(nk).getByText('2 minutes ago')).toBeTruthy()
    expect(within(nk).getByRole('button', { name: 'Revoke' })).toBeTruthy()

    const mb = await row('inst-mb')
    expect(connection(mb)).toEqual({
      text: 'Offline · last seen 5 minutes ago',
      tone: 'muted',
      dot: 'offline'
    })
    expect(connection(await row('inst-si'))).toEqual({
      text: 'Offline',
      tone: 'muted',
      dot: 'offline'
    })

    const tv = await row('inst-tv')
    expect((tv.firstElementChild as HTMLElement).className).toContain('opacity-[.55]')
    expect(connection(tv)).toEqual({
      text: 'Revoked 2026-09-02 · keeps their copy',
      tone: 'faint',
      dot: 'transparent'
    })
    expect(within(tv).getByText('2026-09-02 08:11')).toBeTruthy()
    expect(within(tv).queryByRole('button')).toBeNull()
  })

  it('pulses a syncing row while a round runs with that peer', async () => {
    setup({ state: sync({ phase: 'syncing' }) })
    const nk = await row('inst-nk')
    await waitFor(() =>
      expect(connection(nk)).toEqual({ text: 'Syncing', tone: 'secondary', dot: 'accent' })
    )
    expect(within(nk).getByTestId('member-connection').querySelector('span')?.className).toContain(
      'animate-pulse'
    )
  })

  it('lists a pending join with its suggested code and a Review action', async () => {
    setup({ roster: members({ pendingJoins: [JO] }) })
    const jo = await row('pending:req-1')
    expect(within(jo).getByText('JO?')).toBeTruthy()
    expect(within(jo).getByText('J. Okafor')).toBeTruthy()
    // Role and Last synced both read "—" for a join not yet approved.
    expect(within(jo).getAllByText('—')).toHaveLength(2)
    expect(connection(jo)).toEqual({
      text: 'Pending your approval',
      tone: 'warning',
      dot: 'warning'
    })
    expect(within(jo).getByRole('button', { name: 'Review' })).toBeTruthy()
    expect(within(jo).queryByRole('button', { name: 'Revoke' })).toBeNull()
  })

  it('pauses a row on a newer Birdbrain, names where it stopped and offers the update', async () => {
    const at = minutesAgo(1)
    setup({
      state: sync({
        phase: 'error',
        peers: [
          peer('inst-nk', { reachable: true }),
          peer('inst-mb'),
          peer('inst-si', { lastSessionAt: at, ok: false, heldHead: 3 })
        ],
        lastError: { kind: 'newer-version', at, installationId: 'inst-si', index: 3 }
      })
    })
    const si = await row('inst-si')
    await waitFor(() =>
      expect(connection(si)).toEqual({
        text: 'Paused · newer Birdbrain',
        tone: 'danger',
        dot: 'danger'
      })
    )
    expect(within(si).getByText(/^today \d\d:\d\d · up to SI·0003$/)).toBeTruthy()
    const strip = within(si).getByTestId('newer-version-strip')
    expect(strip.querySelector('p')?.textContent).toBe(
      'Sync with S. Idris is paused. Their Birdbrain is newer than this one and wrote an entry ' +
        'this version cannot read. Received up to SI·0003; SI·0004 and later wait on their ' +
        'machine. Sync with them resumes after this computer updates. Other members are not ' +
        'affected.'
    )
    expect(strip.className).toContain('border-danger-line')
    fireEvent.click(within(strip).getByRole('button', { name: 'Check for updates' }))
    await waitFor(() => expect(bridge.check).toHaveBeenCalled())
    expect(connection(await row('inst-nk')).text).toBe('Connected')
  })

  it('hides Invite and Revoke from a member who is not the Owner', async () => {
    setup({ roster: members({ isOwner: false, installationId: 'inst-nk' }) })
    const nk = await row('inst-nk')
    expect(within(nk).getByText('Member · you')).toBeTruthy()
    expect(connection(nk).text).toBe('This machine')
    expect(within(await row('inst-ar')).getByText('Owner')).toBeTruthy()
    expect(screen.queryByTestId('invite-button')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Revoke' })).toBeNull()
    expect(
      within(await screen.findByTestId('identity-card')).getByText('Member · Member Code NK')
    ).toBeTruthy()
  })

  it('creates an invite from the roster and opens the dialog on the string', async () => {
    setup({})
    fireEvent.click(await screen.findByTestId('invite-button'))
    await waitFor(() => expect(bridge.createInvite).toHaveBeenCalledWith(CASE_ID, undefined))
    const dialog = await screen.findByTestId('invite-dialog')
    expect(dialog.dataset.step).toBe('created')
    expect(
      within(dialog).getByRole('heading', { name: 'Invite to Operation Nightjar' })
    ).toBeTruthy()
    expect(within(dialog).getByTestId('invite-string').textContent).toBe('bbinvite1x')
  })

  it('keeps an existing join request available through Review while showing a new invite', async () => {
    setup({ roster: members({ pendingJoins: [JO] }) })
    fireEvent.click(await screen.findByTestId('invite-button'))
    const dialog = await screen.findByTestId('invite-dialog')
    expect(dialog.dataset.step).toBe('created')
    expect(within(dialog).getByTestId('invite-string').textContent).toBe('bbinvite1x')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
    fireEvent.click(within(await row('pending:req-1')).getByRole('button', { name: 'Review' }))
    expect((await screen.findByTestId('invite-dialog')).dataset.step).toBe('request')
  })

  it('reopens an invite still open on its waiting step without the string', async () => {
    setup({
      roster: members({ invites: [{ inviteId: 'inv-9', expiresAt: '2026-09-20T14:07:00.000Z' }] })
    })
    fireEvent.click(await screen.findByTestId('invite-button'))
    const dialog = await screen.findByTestId('invite-dialog')
    expect(dialog.dataset.step).toBe('waiting')
    expect(within(dialog).getByText('Waiting for someone to use this invite')).toBeTruthy()
    expect(within(dialog).queryByRole('button', { name: 'Copy again' })).toBeNull()
    expect(bridge.createInvite).not.toHaveBeenCalled()
  })

  it('shows an Invite refusal beside the button and a relay refusal as the banner', async () => {
    setup({})
    bridge.createInvite.mockRejectedValueOnce(refusal('not-owner'))
    fireEvent.click(await screen.findByTestId('invite-button'))
    expect((await screen.findByTestId('invite-error')).textContent).toBe(
      'Only the Owner of this Case can do that.'
    )
    expect(screen.queryByTestId('invite-dialog')).toBeNull()
    bridge.createInvite.mockRejectedValueOnce(refusal('relay-unreachable'))
    fireEvent.click(screen.getByTestId('invite-button'))
    expect((await screen.findByTestId('relay-unreachable-banner')).textContent).toContain(
      'Relay unreachable since'
    )
  })

  it('opens the join request from a pending row’s Review', async () => {
    setup({ roster: members({ pendingJoins: [JO] }) })
    fireEvent.click(within(await row('pending:req-1')).getByRole('button', { name: 'Review' }))
    const dialog = await screen.findByTestId('invite-dialog')
    expect(dialog.dataset.step).toBe('request')
    expect(within(dialog).getByRole('heading', { name: 'Join request' })).toBeTruthy()
    expect((within(dialog).getByTestId('member-code-input') as HTMLInputElement).value).toBe('JO')
  })

  it('opens the revoke confirmation from a row and revokes that member', async () => {
    setup({})
    const nk = await row('inst-nk')
    fireEvent.click(within(nk).getByRole('button', { name: 'Revoke' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Revoke N. Kowalski?' })).toBeTruthy()
    await waitFor(() =>
      expect(within(dialog).getByText(/Their 1 Exhibit \(NK-1\), notes, and tags/)).toBeTruthy()
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(bridge.revoke).toHaveBeenCalledWith(CASE_ID, 'inst-nk'))
  })
})

describe('the relay-unreachable banner', () => {
  it('rises from a refused Sync now, names who waits on the relay, and retries', async () => {
    setup({})
    await screen.findByTestId('members-list')
    bridge.syncNow.mockRejectedValueOnce(refusal('relay-unreachable'))
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    const banner = await screen.findByTestId('relay-unreachable-banner')
    expect(within(banner).getByText(/^Relay unreachable since \d\d:\d\d$/)).toBeTruthy()
    expect(
      within(banner).getByText(
        'Last reached: NK. Not reached: MB and SI. Try syncing again after the relay answers.'
      )
    ).toBeTruthy()
    expect(banner.className).toContain('border-warning-line')
    fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(bridge.syncNow).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByTestId('relay-unreachable-banner')).toBeNull())
  })

  it.each<SharingSyncOutcome[]>([
    [{ installationId: 'inst-nk', outcome: 'unreachable' }],
    [{ installationId: 'inst-nk', outcome: 'no-address' }],
    [{ installationId: 'inst-nk', outcome: 'failed', detail: 'Handshake failed' }],
    [
      {
        installationId: 'inst-nk',
        outcome: 'synced',
        entries: 0,
        blobs: 0,
        rowsApplied: 0,
        errors: 1
      }
    ]
  ])(
    'keeps an unsuccessful retry visible without clearing the relay warning: %j',
    async (outcome) => {
      setup({})
      await screen.findByTestId('members-list')
      bridge.syncNow.mockRejectedValueOnce(refusal('relay-unreachable'))
      fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
      const banner = await screen.findByTestId('relay-unreachable-banner')
      bridge.syncNow.mockResolvedValueOnce([outcome])
      fireEvent.click(within(banner).getByRole('button', { name: 'Retry' }))
      await waitFor(() =>
        expect(screen.getByTestId('sync-headline').textContent).toContain('Sync incomplete')
      )
      expect(screen.getByTestId('relay-unreachable-banner')).toBeTruthy()
    }
  )

  it('reports partial failure from Sync now even when another peer completed', async () => {
    setup({})
    await screen.findByTestId('members-list')
    bridge.syncNow.mockResolvedValueOnce([
      {
        installationId: 'inst-nk',
        outcome: 'synced',
        entries: 1,
        blobs: 1,
        rowsApplied: 0,
        errors: 0
      },
      { installationId: 'inst-mb', outcome: 'unreachable' }
    ])
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await screen.findByText('Sync incomplete · 1 of 2 peers completed without errors')
  })

  it('does not call an empty sync attempt recovery', async () => {
    setup({})
    await screen.findByTestId('members-list')
    bridge.syncNow.mockResolvedValueOnce([])
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    await screen.findByText('No peers were available for this sync attempt.')
    expect(screen.getByTestId('sync-headline').textContent).not.toContain('Synced')
  })

  it('moves focus to the relay field from Change relay', async () => {
    setup({})
    await screen.findByTestId('members-list')
    bridge.syncNow.mockRejectedValueOnce(refusal('relay-unreachable'))
    fireEvent.click(screen.getByRole('button', { name: 'Sync now' }))
    const banner = await screen.findByTestId('relay-unreachable-banner')
    fireEvent.click(within(banner).getByRole('button', { name: 'Change relay' }))
    expect(document.activeElement).toBe(screen.getByLabelText('Relay URL'))
  })
})
