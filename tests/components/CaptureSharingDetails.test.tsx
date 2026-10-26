import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { Capture } from '@shared/types'
import type { ManifestEntry } from '@shared/schemas'
import { CaptureSharingDetails } from '@renderer/components/sharing/CaptureSharingDetails'
import { exclusionsOf } from '@renderer/components/sharing/memberModel'
import { useCaptureSharing } from '@renderer/components/sharing/useCaptureSharing'
import { fakeBridge } from '../renderer/fakeBridge'
import { members, snapshot, MERGE_31 } from './sharingFixtures'

afterEach(cleanup)
const capture: Capture = {
  id: 'capture-nk',
  caseId: 'case-1',
  title: 'Other member capture',
  url: 'https://example.com',
  hash: 'h',
  timestamp: '2026-09-19T12:00:00Z',
  createdAt: '2026-09-19T12:00:00Z',
  format: 'mhtml',
  method: 'extension',
  operatorId: 'inst-nk',
  exhibitCitation: 'NK-12',
  manifestIndex: 18
}
const exclusion: ManifestEntry = {
  ...MERGE_31,
  type: 'exclude',
  exhibitId: capture.id,
  authorInstallationId: 'inst-nk',
  reason: 'duplicate',
  index: 32
}

function setup(excluded = false, verified = false, own = false, broken = false) {
  const excludeExhibit = vi.fn(async () => ({
    exhibitId: capture.id,
    authorInstallationId: 'inst-nk',
    index: 32,
    timestamp: MERGE_31.timestamp,
    operatorName: 'A. Renner'
  }))
  fakeBridge({ sharing: { excludeExhibit } })
  const client = new QueryClient()
  const state = snapshot(excluded ? [MERGE_31, exclusion] : [MERGE_31])
  if (broken) state.chain = { valid: false, brokenAt: 32, reason: 'signature mismatch' }
  render(
    <QueryClientProvider client={client}>
      <CaptureSharingDetails
        capture={{
          ...capture,
          exhibitCitation: own ? 'AR-12' : capture.exhibitCitation,
          operatorId: own ? 'inst-ar' : capture.operatorId,
          lastVerifiedStatus: verified ? 'verified' : 'tampered',
          lastVerifiedAt: verified ? '2026-09-19T13:00:00Z' : undefined
        }}
        sharing={{
          members: members(),
          snapshot: state,
          exclusions: exclusionsOf(state)
        }}
      />
    </QueryClientProvider>
  )
  return { excludeExhibit }
}

describe('Capture sharing details', () => {
  it('offers Owner exclusion before another member joins, with the prefix hidden', async () => {
    const roster = members()
    const excludeExhibit = vi.fn(async () => ({
      exhibitId: capture.id,
      authorInstallationId: roster.installationId,
      index: 32,
      timestamp: MERGE_31.timestamp,
      operatorName: 'A. Renner'
    }))
    fakeBridge({
      cases: {
        get: vi.fn(async () => ({
          id: capture.caseId,
          name: 'Shared',
          sharedAt: MERGE_31.timestamp,
          isDemo: false,
          archived: false,
          createdAt: MERGE_31.timestamp,
          updatedAt: MERGE_31.timestamp
        }))
      },
      sharing: {
        getMembers: vi.fn(async () => ({
          ...roster,
          members: roster.members.filter((entry) => entry.installationId === roster.installationId)
        })),
        excludeExhibit
      },
      manifest: { snapshot: vi.fn(async () => snapshot([])) }
    })
    function BeforeFirstJoin() {
      const sharing = useCaptureSharing(capture.caseId, false)
      return (
        <CaptureSharingDetails
          capture={{ ...capture, exhibitCitation: '12', operatorId: 'inst-ar' }}
          sharing={sharing}
        />
      )
    }
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BeforeFirstJoin />
      </QueryClientProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Exclude from export' }))
    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Exclude 12 from export?' })).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Exclude from export' }))
    await waitFor(() =>
      expect(excludeExhibit).toHaveBeenCalledWith(capture.caseId, capture.id, undefined)
    )
  })
  it('lets the Owner exclude their own Capture', () => {
    setup(false, false, true)
    expect(screen.getByRole('button', { name: 'Exclude from export' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from export' }))
    expect(screen.getByRole('heading', { name: 'Exclude AR-12 from export?' })).toBeTruthy()
  })
  it('attributes the capture and the merge that received it', () => {
    setup()
    expect(screen.getByTestId('capture-sharing-details').textContent).toContain(
      'Captured by N. Kowalski (NK)'
    )
    expect(screen.getByTestId('capture-sharing-details').textContent).toContain('in merge #0031')
  })

  it('records the Owner exclusion only after confirmation with the reason', async () => {
    const { excludeExhibit } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Exclude from export' }))
    const dialog = screen.getByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: ' duplicate ' } })
    expect(excludeExhibit).not.toHaveBeenCalled()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Exclude from export' }))
    await waitFor(() =>
      expect(excludeExhibit).toHaveBeenCalledWith('case-1', capture.id, 'duplicate')
    )
  })

  it('shows a neutral exclusion without claiming changed bytes verify', () => {
    setup(true)
    const banner = screen.getByTestId('capture-exclusion-banner')
    expect(banner.textContent).toContain('Excluded from export by A. Renner (Owner)')
    expect(banner.textContent).not.toContain('hash still verify')
    expect(banner.className).not.toMatch(/warning|danger/)
  })

  it('does not treat a parsed exclusion in a broken chain as effective', () => {
    setup(true, true, false, true)
    expect(screen.queryByTestId('capture-exclusion-banner')).toBeNull()
    expect(screen.getByRole('button', { name: 'Exclude from export' })).toBeTruthy()
  })

  it('dates the integrity sentence to the persisted verification', () => {
    setup(true, true)
    const text = screen.getByTestId('capture-exclusion-banner').textContent
    expect(text).toContain(
      'At the last verification on 2026-09-19 13:00, the entry, bytes, and hash verified.'
    )
    expect(text).not.toContain('still verify')
  })

  it('keeps Owner exclusion available when the payload cannot establish authorship', () => {
    fakeBridge()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CaptureSharingDetails
          capture={{ ...capture, operatorId: undefined }}
          sharing={{ members: members() }}
        />
      </QueryClientProvider>
    )
    expect(screen.queryByText(/Captured by/)).toBeNull()
    expect(screen.getByRole('button', { name: 'Exclude from export' })).toBeTruthy()
  })
})
