// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CaseCard } from '@renderer/components/dashboard/CaseCard'
import type { Case, SharingMembers } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'
import { AR, members } from './sharingFixtures'

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }))

const LOCAL: Case = {
  id: 'case-1',
  name: 'Investigation One',
  description: '',
  isDemo: false,
  archived: false,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z'
}
const SHARED: Case = { ...LOCAL, sharedAt: '2026-09-19T14:00:00.000Z' }

function renderCard(
  caseData: Case,
  roster: SharingMembers = members(),
  flags: { isRecording?: boolean; isActive?: boolean } = {}
) {
  fakeBridge({ sharing: { getMembers: vi.fn(async () => roster) } })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <CaseCard
        caseData={caseData}
        isRecording={flags.isRecording ?? false}
        isActive={flags.isActive ?? false}
        captureCount={2}
        onClick={vi.fn()}
        onRename={vi.fn()}
        onDelete={vi.fn()}
      />
    </QueryClientProvider>
  )
}

afterEach(() => cleanup())

// The badge and the role line of docs/design-handoff/2026-10-28-share-a-case/,
// frame E.
describe('the Case card', () => {
  it('says a local Case is on this machine only and carries no badge', () => {
    renderCard(LOCAL)
    const line = screen.getByTestId('case-role-line')
    expect(line.dataset.kind).toBe('local')
    expect(line.textContent).toBe('On this machine only')
    expect(screen.queryByTestId('case-shared-badge')).toBeNull()
  })

  it('badges a shared Case with its member count and tells the Owner they own them', async () => {
    renderCard(SHARED)
    const badge = await screen.findByTestId('case-shared-badge')
    expect(badge.textContent).toBe('Shared · 4')
    expect(badge.title).toBe('Shared with 3 teammates')
    const line = screen.getByTestId('case-role-line')
    expect(line.dataset.kind).toBe('owner')
    expect(line.textContent).toBe('ARYou own · 4 members')
  })

  it('tells a member who shared the Case, beside their own chip', async () => {
    renderCard(SHARED, members({ installationId: 'inst-nk', isOwner: false }))
    const line = await screen.findByTestId('case-role-line')
    expect(line.dataset.kind).toBe('joined')
    expect(line.textContent).toBe('NKShared by A. Renner')
  })

  it('waits on an open invite while the Owner is alone, with no badge yet', async () => {
    const expiresAt = new Date(Date.now() + 3_600_000).toISOString()
    renderCard(SHARED, members({ members: [AR], invites: [{ inviteId: 'inv-1', expiresAt }] }))
    const line = await screen.findByTestId('case-role-line')
    expect(line.dataset.kind).toBe('invite')
    expect(line.textContent).toMatch(/^Invite waiting · expires (today|tomorrow) \d\d:\d\d$/)
    expect(screen.queryByTestId('case-shared-badge')).toBeNull()
  })

  it('lets Recording outrank the badge while the role line still says the Case is shared', async () => {
    renderCard(SHARED, members(), { isRecording: true })
    expect(screen.getByText('Recording')).toBeTruthy()
    const line = await screen.findByTestId('case-role-line')
    expect(line.textContent).toBe('ARYou own · 4 members')
    expect(screen.queryByTestId('case-shared-badge')).toBeNull()
  })
})
