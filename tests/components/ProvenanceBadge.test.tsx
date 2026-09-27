// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ProvenanceBadge } from '@renderer/components/captures/ProvenanceBadge'
import type { Capture, HashVerification } from '@shared/types'
import { fakeBridge } from '../renderer/fakeBridge'

// An un-stamped capture, hydrated from the persisted verification columns so the
// badge renders without a verify round trip. Every capture looks like this while
// trusted timestamping is declined: the manifest resolves 'pending' for any
// capture entry carrying no token, and it has no record of the operator's
// setting to resolve anything else from.
const capture: Capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/evidence/page',
  title: 'Example evidence page',
  hash: 'h',
  timestamp: '2026-09-01T10:00:00.000Z',
  createdAt: '2026-09-01T10:00:00.000Z',
  format: 'mhtml',
  method: 'extension',
  lastVerifiedStatus: 'verified',
  lastVerifiedHash: 'h',
  trustedTimeStatus: 'pending'
}

function mount(tsaEnabled: boolean | undefined, override: Partial<Capture> = {}, verify = vi.fn()) {
  fakeBridge({
    settings: { get: vi.fn().mockResolvedValue({ tsaEnabled }) },
    captures: { verify }
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<ProvenanceBadge capture={{ ...capture, ...override }} />, { wrapper: Wrapper })
}

afterEach(cleanup)

describe('ProvenanceBadge trusted-time chip (#1169)', () => {
  it('reads as the operator’s own decision when timestamping is declined', async () => {
    mount(false)
    // Not "pending": nothing is in flight, and an amber chip on every capture
    // would read as something going wrong rather than as a setting.
    const chip = await screen.findByText('No trusted timestamp')
    expect(chip.getAttribute('title')).toContain('off for this installation')
    expect(screen.queryByText('Timestamp pending')).toBeNull()
  })

  it('keeps the pending chip while timestamping is on', async () => {
    mount(true)
    expect(await screen.findByText('Timestamp pending')).toBeDefined()
    expect(screen.queryByText('No trusted timestamp')).toBeNull()
  })

  it('does not claim a timestamp was asked for, in either state', async () => {
    for (const enabled of [true, false]) {
      cleanup()
      mount(enabled)
      const chip = await screen.findByText(
        enabled ? 'Timestamp pending' : 'No trusted timestamp'
      )
      // The manifest records tokens, not requests, so no title may assert one
      // was made — with timestamping declined none was.
      expect(chip.getAttribute('title')).not.toMatch(/awaiting|requested/i)
    }
  })

  it('shows the stamped chip regardless of the current setting', async () => {
    // A capture stamped before the opt-out keeps its token and its chip; turning
    // the setting off withdraws nothing already obtained.
    mount(false, { trustedTimeStatus: 'rfc3161' })
    expect(await screen.findByText('Timestamped')).toBeDefined()
  })

  it('treats a settings read that has not resolved as enabled', async () => {
    mount(undefined)
    await waitFor(() => expect(screen.getByText('Timestamp pending')).toBeDefined())
  })
})

describe('ProvenanceBadge verifier-too-old (X25)', () => {
  it('names the outcome from the persisted status, not as a broken chain', async () => {
    mount(true, { lastVerifiedStatus: 'verifier-too-old' })
    const chip = await screen.findByText('Verifier too old')
    expect(chip.getAttribute('title')).toContain('newer schema')
    expect(screen.queryByText('Chain broken')).toBeNull()
    expect(screen.queryByText('Tampered')).toBeNull()
  })

  it('shows the chain reason from a fresh verify', async () => {
    const reason = "Entry type 'annotation-burn' from a newer schema; verifier too old"
    const fresh: HashVerification = {
      captureId: capture.id,
      url: capture.url,
      title: capture.title,
      storedHash: 'h',
      computedHash: 'h',
      status: 'verifier-too-old',
      chainValid: false,
      reason,
      trustedTime: 'pending'
    }
    mount(true, {}, vi.fn().mockResolvedValue(fresh))
    fireEvent.click(await screen.findByText(/^Verified/))
    const chip = await screen.findByText('Verifier too old')
    expect(chip.getAttribute('title')).toBe(reason)
  })
})
