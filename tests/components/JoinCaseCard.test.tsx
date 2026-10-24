import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { JoinCaseCard } from '@renderer/components/dashboard/cases/JoinCaseCard'
import { fakeBridge } from '../renderer/fakeBridge'
import { refusal } from './sharingFixtures'

afterEach(cleanup)

function setup(join = vi.fn(async () => ({ caseId: 'joined', caseName: 'Shared' }))) {
  const onJoined = vi.fn()
  const onBack = vi.fn()
  fakeBridge({
    sharing: {
      readInvite: vi.fn(async () => ({
        caseId: 'joined',
        ownerName: 'Alex',
        expiresAt: '2099-01-01T00:00:00Z'
      })),
      join
    }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <JoinCaseCard onBack={onBack} onJoined={onJoined} />
    </QueryClientProvider>
  )
  return { join, onJoined, onBack }
}

async function pasteAndJoin() {
  fireEvent.change(screen.getByLabelText('Invite'), { target: { value: 'bbinvite1example' } })
  await screen.findByText('Alex')
  fireEvent.click(screen.getByRole('button', { name: 'Join' }))
}

describe('JoinCaseCard', () => {
  it('previews offline and navigates only after the join succeeds', async () => {
    const { join, onJoined } = setup()
    await pasteAndJoin()
    await waitFor(() => expect(onJoined).toHaveBeenCalledWith('joined'))
    expect(join).toHaveBeenCalledWith('bbinvite1example')
  })

  it.each([
    ['invite-expired', 'This invite has expired', 'Paste another'],
    ['invite-reused', 'This invite was already used', 'Paste another'],
    ['owner-unreachable', 'Alex is not online', 'Try again'],
    ['relay-unreachable', 'Cannot reach Alex or the relay', 'Retry'],
    ['declined', 'Alex declined', 'Close']
  ])('shows the %s refusal and its action', async (code, title, action) => {
    const { onJoined, onBack } = setup(vi.fn().mockRejectedValue(refusal(code)))
    await pasteAndJoin()
    await screen.findByText(title)
    expect(onJoined).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: action }))
    if (action === 'Close') expect(onBack).toHaveBeenCalled()
    if (action === 'Paste another')
      expect((screen.getByLabelText('Invite') as HTMLTextAreaElement).value).toBe('')
  })

  it('disables leaving and a second submission during approval', async () => {
    setup(vi.fn(() => new Promise(() => {})))
    await pasteAndJoin()
    await screen.findByRole('status')
    expect((screen.getByRole('button', { name: 'Back' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Join' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
