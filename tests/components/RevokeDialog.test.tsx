// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { InventoryRow } from '@shared/types'
import { RevokeDialog } from '@renderer/components/sharing/RevokeDialog'
import { fakeBridge } from '../renderer/fakeBridge'
import { CASE_ID, exhibitRow, refusal } from './sharingFixtures'

const SI = { installationId: 'inst-si', code: 'SI', name: 'S. Idris' }

let revoke: ReturnType<typeof vi.fn>
let rows: InventoryRow[]

function renderDialog() {
  const onOpenChange = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<RevokeDialog caseId={CASE_ID} open target={SI} onOpenChange={onOpenChange} />, {
    wrapper: Wrapper
  })
  return { onOpenChange }
}

beforeEach(() => {
  revoke = vi.fn(async () => ({}))
  rows = [
    exhibitRow('SI-1', 1),
    exhibitRow('NK-1', 1),
    exhibitRow('SI-2', 2),
    exhibitRow('SI-3', 3)
  ]
  fakeBridge({
    sharing: { revoke },
    exhibits: { inventory: vi.fn(async () => ({ caseId: CASE_ID, rows })) }
  })
})

afterEach(cleanup)

// "Revoke S. Idris?" (#1514, mock 1g), with the brief's copy: the member keeps
// the copy they already have, and the entry is a member-revoke.
describe('RevokeDialog', () => {
  it('names the member and the range of their Exhibits', async () => {
    renderDialog()
    expect(screen.getByRole('heading', { name: 'Revoke S. Idris?' })).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.getByText(
          'S. Idris will stop receiving updates. They keep the copy of this Case they already ' +
            'have. Their 3 Exhibits (SI-1–SI-3), notes, and tags stay in the Case, attributed to ' +
            'them.'
        )
      ).toBeTruthy()
    )
    expect(
      screen.getByText(
        'Recorded in your Manifest as member-revoke. Cannot be undone; they would need a new ' +
          'invite.'
      )
    ).toBeTruthy()
  })

  it('uses the remaining citations after earlier Exhibits are deleted', async () => {
    rows = [exhibitRow('SI-2', 2), exhibitRow('SI-3', 3)]
    renderDialog()
    await screen.findByText(/Their 2 Exhibits \(SI-2–SI-3\)/)
    expect(screen.queryByText(/SI-1/)).toBeNull()
  })

  it('does not invent a continuous range across missing Exhibits', async () => {
    rows = [exhibitRow('SI-1', 1), exhibitRow('SI-3', 3)]
    renderDialog()
    await screen.findByText(/Their 2 Exhibits, notes, and tags/)
  })

  it('drops the Exhibit clause when the member has none', async () => {
    rows = [exhibitRow('NK-1', 1)]
    renderDialog()
    await waitFor(() =>
      expect(screen.getByText(/Their notes, and tags stay in the Case, attributed to them\./))
    )
    expect(screen.queryByText(/Exhibits/)).toBeNull()
  })

  it('revokes through the sharing channel and closes', async () => {
    const { onOpenChange } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    await waitFor(() => expect(revoke).toHaveBeenCalledWith(CASE_ID, 'inst-si'))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it.each([
    ['owner-not-revocable', 'The Owner cannot be revoked.'],
    ['already-revoked', 'This member is already revoked.'],
    ['not-owner', 'Only the Owner of this Case can do that.'],
    ['not-a-member', 'This installation is not a member of this Case.']
  ])('shows a %s refusal inline and stays open', async (code, message) => {
    revoke.mockRejectedValue(refusal(code))
    const { onOpenChange } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect((await screen.findByTestId('revoke-error')).textContent).toBe(message)
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it('shows main’s own message for a refusal it has no words for', async () => {
    revoke.mockRejectedValue(new Error('Case not found'))
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }))
    expect((await screen.findByTestId('revoke-error')).textContent).toBe('Case not found')
  })

  it('closes on Cancel without revoking', () => {
    const { onOpenChange } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(revoke).not.toHaveBeenCalled()
  })
})
