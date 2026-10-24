// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { SharingMembers } from '@shared/types'
import { InviteDialog, type InviteStart } from '@renderer/components/sharing/InviteDialog'
import { fakeBridge } from '../renderer/fakeBridge'
import { CASE_ID, JO, member, members, refusal } from './sharingFixtures'

// 2026-09-19 14:07 UTC, the clock the mock's invite was created on.
const NOW = Date.parse('2026-09-19T14:07:00.000Z')
const INVITE = {
  inviteId: 'inv-1',
  invite:
    'bbinvite1mfrggzdfmzt' + 'wq2lknnwg2zlonfxxaylcmvygczlsmfzxi2lpnyqgc3teebtg64ranfxhm2lumu2g',
  expiresAt: '2026-09-20T14:07:00.000Z'
}
const CREATED: InviteStart = { kind: 'created', invite: INVITE }
const WAITING: InviteStart = {
  kind: 'waiting',
  inviteId: 'inv-1',
  expiresAt: INVITE.expiresAt,
  invite: INVITE.invite
}
const REQUEST: InviteStart = { kind: 'request', join: JO }

let bridge: {
  cancelInvite: ReturnType<typeof vi.fn>
  approveJoin: ReturnType<typeof vi.fn>
  declineJoin: ReturnType<typeof vi.fn>
  getMembers: ReturnType<typeof vi.fn>
}
let writeText: ReturnType<typeof vi.fn>

function renderDialog(start: InviteStart, roster: SharingMembers = members()) {
  const onOpenChange = vi.fn()
  const onInviteGone = vi.fn()
  const onRefusal = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  const view = render(
    <InviteDialog
      caseId={CASE_ID}
      caseName="Operation Nightjar"
      members={roster}
      open
      start={start}
      nowMs={NOW}
      onOpenChange={onOpenChange}
      onInviteGone={onInviteGone}
      onRefusal={onRefusal}
    />,
    { wrapper: Wrapper }
  )
  return { ...view, client, onOpenChange, onInviteGone, onRefusal }
}

function dialog() {
  return screen.getByTestId('invite-dialog')
}

beforeEach(() => {
  bridge = {
    cancelInvite: vi.fn(async () => undefined),
    approveJoin: vi.fn(async () =>
      member('inst-jo', 'JO', 'J. Okafor', 32, { fingerprint: JO.fingerprint })
    ),
    declineJoin: vi.fn(async () => undefined),
    getMembers: vi.fn(async () => members())
  }
  fakeBridge({ sharing: bridge })
  writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

afterEach(cleanup)

describe('InviteDialog, invite created (mock 1c step 1)', () => {
  it('shows an arriving QR join without requiring Copy first', () => {
    renderDialog(CREATED, members({ pendingJoins: [JO] }))
    expect(dialog().dataset.step).toBe('request')
    expect(screen.getByRole('button', { name: 'Approve' })).toBeTruthy()
  })
  it('names the Case, explains the invite and shows the string with its expiry', () => {
    renderDialog(CREATED)
    expect(screen.getByRole('heading', { name: 'Invite to Operation Nightjar' })).toBeTruthy()
    expect(
      screen.getByText(
        'Send this to one person over a channel you already use, such as Signal or email. It ' +
          'works once and expires in 24 hours. You need to be online when they use it.'
      )
    ).toBeTruthy()
    expect(screen.getByTestId('invite-string').textContent).toBe(INVITE.invite)
    expect(screen.getByTestId('invite-string').textContent?.startsWith('bbinvite1')).toBe(true)
    expect(screen.getByText('Expires tomorrow 14:07')).toBeTruthy()
  })

  it('shows the QR code by default and toggles it', () => {
    renderDialog(CREATED)
    expect(screen.getByRole('img', { name: 'QR code for the same invite' })).toBeTruthy()
    expect(
      screen.getByText(
        'Same invite as the text. Useful when the peer is in the room: they scan it from the ' +
          'Join screen. The code is the invite itself, so treat the screen like the string.'
      )
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Hide QR' }))
    expect(screen.queryByRole('img', { name: 'QR code for the same invite' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Show QR' }))
    expect(screen.getByRole('img', { name: 'QR code for the same invite' })).toBeTruthy()
  })

  it('copies the string and moves to waiting', async () => {
    renderDialog(CREATED)
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INVITE.invite))
    await waitFor(() => expect(dialog().dataset.step).toBe('waiting'))
    expect(screen.getByText('Waiting for someone to use this invite')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy again' })).toBeTruthy()
  })

  it('stays on the string when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    renderDialog(CREATED)
    fireEvent.click(screen.getByRole('button', { name: 'Copy invite' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    expect(dialog().dataset.step).toBe('created')
  })
})

describe('InviteDialog, waiting (mock 1c step 2)', () => {
  it('reads the mock’s copy with the expiry phrase', () => {
    renderDialog(WAITING)
    expect(screen.getByRole('heading', { name: 'Invite to Operation Nightjar' })).toBeTruthy()
    expect(screen.getByText('Waiting for someone to use this invite')).toBeTruthy()
    expect(
      screen.getByText(
        'You can close this. The invite stays valid until tomorrow 14:07 or until it is used. ' +
          'A join request will appear in Members.'
      )
    ).toBeTruthy()
  })

  it('copies again while this window holds the string', async () => {
    renderDialog(WAITING)
    fireEvent.click(screen.getByRole('button', { name: 'Copy again' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(INVITE.invite))
  })

  it('hides Copy again when the string is not held', () => {
    renderDialog({ ...WAITING, invite: null })
    expect(screen.queryByRole('button', { name: 'Copy again' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel invite' })).toBeTruthy()
  })

  it('cancels the invite, tells the parent and closes', async () => {
    const { onOpenChange, onInviteGone } = renderDialog(WAITING)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite' }))
    await waitFor(() => expect(bridge.cancelInvite).toHaveBeenCalledWith(CASE_ID, 'inv-1'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onInviteGone).toHaveBeenCalled()
  })

  it('closes and refetches the roster when main no longer knows the invite', async () => {
    bridge.cancelInvite.mockRejectedValue(refusal('invite-not-found'))
    const { client, onOpenChange, onInviteGone } = renderDialog(WAITING)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(onInviteGone).toHaveBeenCalled()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sharing', 'members', CASE_ID] })
  })

  it('shows any other refusal inline and stays open', async () => {
    bridge.cancelInvite.mockRejectedValue(refusal('not-owner'))
    const { onOpenChange } = renderDialog(WAITING)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel invite' }))
    expect((await screen.findByTestId('invite-dialog-error')).textContent).toBe(
      'Only the Owner of this Case can do that.'
    )
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('closes on Done', () => {
    const { onOpenChange } = renderDialog(WAITING)
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(bridge.cancelInvite).not.toHaveBeenCalled()
  })

  it('moves to the join request when one arrives', () => {
    renderDialog(WAITING, members({ pendingJoins: [JO] }))
    expect(dialog().dataset.step).toBe('request')
    expect(screen.getByRole('heading', { name: 'Join request' })).toBeTruthy()
  })
})

describe('InviteDialog, join request (mock 1c step 3)', () => {
  it('shows who used the invite, their fingerprint and the suggested code', () => {
    renderDialog(REQUEST)
    expect(screen.getByRole('heading', { name: 'Join request' })).toBeTruthy()
    expect(screen.getByText('An installation used your invite from 14:07.')).toBeTruthy()
    expect(screen.getByText('J. Okafor')).toBeTruthy()
    expect(screen.getByTestId('join-fingerprint').textContent).toBe(
      '7c2f d418 9f3a 1c7e 44b2 08d1 e6a0 5b93'
    )
    const input = screen.getByTestId('member-code-input') as HTMLInputElement
    expect(input.value).toBe('JO')
    expect(screen.getByTestId('member-code-ok').textContent).toBe('Unique in this Case')
    expect(screen.getByTestId('member-code-helper').textContent).toBe(
      'Their Exhibits will read JO-1, JO-2… Up to three characters, A–Z and 0–9. Cannot be ' +
        'changed after approval.'
    )
    expect(
      screen.getByText(
        'The name is what they typed into their own settings. The fingerprint identifies their ' +
          'installation. If you want to be sure this is J. Okafor, ask them to read the ' +
          'fingerprint back over a channel you already trust.'
      )
    ).toBeTruthy()
  })

  it('names the holder of a taken code and offers two alternatives', () => {
    renderDialog(REQUEST)
    fireEvent.change(screen.getByTestId('member-code-input'), { target: { value: 'MB' } })
    expect(screen.getByTestId('member-code-problem').textContent).toBe(
      'MB is M. Brandt’s code. Try MBJ or MB2.'
    )
    expect(screen.queryByTestId('member-code-ok')).toBeNull()
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('treats a revoked member’s code as taken', () => {
    renderDialog(REQUEST)
    fireEvent.change(screen.getByTestId('member-code-input'), { target: { value: 'TV' } })
    expect(screen.getByTestId('member-code-problem').textContent).toMatch(
      /^TV is T\. Vance’s code\./
    )
  })

  it('upper-cases what is typed and reads the helper with it', () => {
    renderDialog(REQUEST)
    fireEvent.change(screen.getByTestId('member-code-input'), { target: { value: 'ok1' } })
    expect((screen.getByTestId('member-code-input') as HTMLInputElement).value).toBe('OK1')
    expect(screen.getByTestId('member-code-ok')).toBeTruthy()
    expect(screen.getByTestId('member-code-helper').textContent).toMatch(
      /^Their Exhibits will read OK1-1, OK1-2…/
    )
  })

  it.each(['MBR1', 'J-O', ''])('refuses %j without a second rule line', (value) => {
    renderDialog(REQUEST)
    const input = screen.getByTestId('member-code-input')
    fireEvent.change(input, { target: { value } })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.queryByTestId('member-code-ok')).toBeNull()
    expect(screen.queryByTestId('member-code-problem')).toBeNull()
    expect((screen.getByRole('button', { name: 'Approve' }) as HTMLButtonElement).disabled).toBe(
      true
    )
    expect(screen.getAllByText(/Up to three characters, A–Z and 0–9\./)).toHaveLength(1)
  })

  it('approves with the typed code and shows the new row with its member-add entry', async () => {
    renderDialog(REQUEST)
    fireEvent.change(screen.getByTestId('member-code-input'), { target: { value: 'jok' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(bridge.approveJoin).toHaveBeenCalledWith(CASE_ID, 'req-1', 'JOK'))
    const done = await screen.findByTestId('invite-done')
    expect(within(done).getByText('JO')).toBeTruthy()
    expect(within(done).getByText('J. Okafor')).toBeTruthy()
    expect(within(done).getByText('Member')).toBeTruthy()
    expect(within(done).getByText('Syncing')).toBeTruthy()
    expect(
      within(done).getByText('Manifest entry member-add #0032 written to your chain.')
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Join request' })).toBeTruthy()
  })

  it('declines through the sharing channel and closes', async () => {
    const { onOpenChange } = renderDialog(REQUEST)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(bridge.declineJoin).toHaveBeenCalledWith(CASE_ID, 'req-1'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('shows a member-code-rejected refusal under the input', async () => {
    bridge.approveJoin.mockRejectedValue(
      refusal('member-code-rejected', 'Member Code taken by another member')
    )
    renderDialog(REQUEST)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect((await screen.findByTestId('member-code-problem')).textContent).toBe(
      'Member Code taken by another member'
    )
    expect(screen.queryByTestId('invite-dialog-error')).toBeNull()
    expect(dialog().dataset.step).toBe('request')
  })

  it.each(['already-member', 'join-request-unknown'])(
    'closes and refetches the roster on %s',
    async (code) => {
      bridge.approveJoin.mockRejectedValue(refusal(code))
      const { client, onOpenChange } = renderDialog(REQUEST)
      const invalidate = vi.spyOn(client, 'invalidateQueries')
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
      expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sharing', 'members', CASE_ID] })
    }
  )

  it.each(['relay-unreachable', 'sharing-unavailable'])(
    'hands a %s refusal to the tab and says so inline',
    async (code) => {
      bridge.approveJoin.mockRejectedValue(refusal(code))
      const { onRefusal, onOpenChange } = renderDialog(REQUEST)
      fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
      await waitFor(() => expect(onRefusal).toHaveBeenCalledWith(code))
      expect(screen.getByTestId('invite-dialog-error')).toBeTruthy()
      expect(onOpenChange).not.toHaveBeenCalled()
    }
  )

  it('closes and refetches when the declined request is already gone', async () => {
    bridge.declineJoin.mockRejectedValue(refusal('join-request-unknown'))
    const { client, onOpenChange } = renderDialog(REQUEST)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['sharing', 'members', CASE_ID] })
  })

  it('closes from the header control', () => {
    const { onOpenChange } = renderDialog(REQUEST)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
