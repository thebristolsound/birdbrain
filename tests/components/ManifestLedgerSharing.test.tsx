import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ManifestLedgerView, ManifestLedgerTab } from '@renderer/components/data/ManifestLedger'
import { fakeBridge } from '../renderer/fakeBridge'
import { members, snapshot, REVOKE, MERGE_31 } from './sharingFixtures'

afterEach(cleanup)

function setup(tab = false, broken = false) {
  fakeBridge({ sharing: { getMembers: vi.fn(async () => members()) } })
  const state = snapshot([REVOKE, { ...MERGE_31, timestamp: '2026-08-01T00:00:00Z' }])
  if (broken) state.chain = { valid: false, brokenAt: 30, reason: 'signature mismatch' }
  const actions = { onShowTarget: vi.fn(), onCopyHash: vi.fn() }
  const client = new QueryClient()
  render(
    <QueryClientProvider client={client}>
      {tab ? (
        <ManifestLedgerTab
          snapshot={state}
          exhibit={{ id: 'ex-1', contentHash: 'hash' }}
          actions={actions}
        />
      ) : (
        <ManifestLedgerView snapshot={state} actions={actions} />
      )}
    </QueryClientProvider>
  )
  return { actions }
}

describe('Shared Case ledger', () => {
  it('defaults to chain order, identifies the writer and keeps the snapshot verdict', async () => {
    setup(false, true)
    await screen.findByRole('button', { name: 'AR · 2' })
    expect(screen.getByText('Actor')).toBeTruthy()
    expect(await within(screen.getByTestId('ledger-row-30')).findByText('AR')).toBeTruthy()
    expect(screen.getByTestId('chain-verdict').textContent).toContain('Chain broken')
    expect(screen.queryByText('Verified chain · Seq is the entry index')).toBeNull()
    expect(screen.getAllByTestId(/ledger-row-\d/).map((row) => row.dataset.entryType)).toEqual([
      'member-revoke',
      'merge'
    ])
  })

  it('sorts the secondary timeline by asserted time and prefixes sequence values', async () => {
    setup()
    await screen.findByRole('button', { name: 'AR · 2' })
    fireEvent.click(screen.getByRole('button', { name: 'Timeline' }))
    expect(screen.getByText('Cross-chain order is by asserted time, not verified')).toBeTruthy()
    expect(screen.getAllByTestId(/ledger-row-\d/).map((row) => row.dataset.entryType)).toEqual([
      'merge',
      'member-revoke'
    ])
    expect(within(screen.getByTestId('ledger-row-31')).getByText('AR·0031')).toBeTruthy()
  })

  it('keeps target and hash actions on the per-Exhibit ledger', async () => {
    const { actions } = setup(true)
    await screen.findByRole('button', { name: 'AR · 2' })
    const row = screen.getByTestId('ledger-row-31')
    fireEvent.keyDown(row, { key: 'Enter' })
    expect(actions.onShowTarget).toHaveBeenCalledWith(expect.objectContaining({ index: 31 }))
    fireEvent.click(within(row).getByRole('button', { name: 'e' }))
    expect(actions.onCopyHash).toHaveBeenCalledWith('e', 'entry hash')
    expect(actions.onShowTarget).toHaveBeenCalledTimes(1)
  })
})
