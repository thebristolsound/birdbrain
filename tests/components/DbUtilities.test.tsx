// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DbUtilities } from '@renderer/components/settings/db/DbUtilities'
import { fakeBridge } from '../renderer/fakeBridge'

const snapshot = {
  fileName: 'pre-migration-v26-to-v27-2026-08-01T09-00-00-000Z.db',
  fromVersion: 26,
  toVersion: 27,
  createdAt: '2026-08-01T09:00:00.000Z',
  sizeBytes: 2_097_152
}

const olderSnapshot = {
  fileName: 'pre-migration-v24-to-v25-2026-07-01T09-00-00-000Z.db',
  fromVersion: 24,
  toVersion: 25,
  createdAt: '2026-07-01T09:00:00.000Z',
  sizeBytes: 1_048_576
}

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function renderUtilities() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { ...render(<DbUtilities />, { wrapper: withClient(client) }), client }
}

// The snapshot rows sit in their own card; every other card also has a
// "Restore" control, so the row is located by its filename first.
function restoreButtonFor(fileName: string): HTMLElement {
  // Up from the filename to the nearest ancestor that owns a button: that is
  // the row, and stopping there is what keeps this test honest about which
  // snapshot the control belongs to.
  let node: HTMLElement | null = screen.getByText(new RegExp(fileName))
  while (node && !node.querySelector('button')) node = node.parentElement
  if (!node) throw new Error(`no restore control rendered for ${fileName}`)
  return within(node).getByRole('button')
}

afterEach(() => {
  cleanup()
})

describe('DbUtilities export controls (#1537)', () => {
  it('names the table and format selects', async () => {
    fakeBridge({ db: { snapshots: vi.fn().mockResolvedValue([]) } })
    renderUtilities()
    expect(screen.getByLabelText('Table to export').tagName).toBe('SELECT')
    expect(screen.getByLabelText('Export format').tagName).toBe('SELECT')
  })
})

describe('DbUtilities — pre-migration snapshots', () => {
  it('says a snapshot is written on the next upgrade when there are none', async () => {
    fakeBridge({ db: { snapshots: vi.fn().mockResolvedValue([]) } })

    renderUtilities()

    expect(await screen.findByText(/No snapshots yet/)).toBeDefined()
  })

  it('lists a snapshot with the upgrade it belongs to and its size', async () => {
    fakeBridge({ db: { snapshots: vi.fn().mockResolvedValue([snapshot]) } })

    renderUtilities()

    expect(await screen.findByText('Schema v26 → v27')).toBeDefined()
    expect(screen.getByText(new RegExp(`2.0 MB · ${snapshot.fileName}`))).toBeDefined()
  })

  it('warns that the restore cannot be undone and points at Backup Database', async () => {
    fakeBridge({ db: { snapshots: vi.fn().mockResolvedValue([snapshot]) } })

    renderUtilities()
    await screen.findByText('Schema v26 → v27')
    fireEvent.click(restoreButtonFor(snapshot.fileName))

    const dialog = screen.getByRole('dialog')
    // The three things the operator cannot get back if the text omits them:
    // the restore is irreversible, no copy of the current database is kept,
    // and there is a control that would have taken one.
    expect(within(dialog).getByText(/It cannot be undone/)).toBeDefined()
    expect(within(dialog).getByText(/does not keep a copy of it/)).toBeDefined()
    expect(within(dialog).getByText(/use Backup Database above first/)).toBeDefined()
    // And it is still not a downgrade.
    expect(within(dialog).getByText(/not back on schema v26/)).toBeDefined()
    // A failed restore is its own outcome, and the dialog must not let the
    // operator read "it cannot be undone" as "if it fails, nothing happened".
    expect(
      within(dialog).getByText(/does not prove the previous database is still intact/)
    ).toBeDefined()
  })

  it('restores the snapshot whose row was clicked and reports the re-migration', async () => {
    const restoreSnapshot = vi.fn().mockResolvedValue({ restored: true })
    fakeBridge({
      db: { snapshots: vi.fn().mockResolvedValue([snapshot, olderSnapshot]), restoreSnapshot }
    })

    renderUtilities()
    await screen.findByText('Schema v26 → v27')
    fireEvent.click(restoreButtonFor(olderSnapshot.fileName))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))

    await waitFor(() =>
      expect(restoreSnapshot).toHaveBeenCalledWith({ fileName: olderSnapshot.fileName })
    )
    // Says what actually happened: the records came back, the schema did not.
    expect(await screen.findByText(/brought back up to the current schema/)).toBeDefined()
  })

  it('marks only the row being restored as in progress', async () => {
    let finish: (value: { restored: boolean }) => void = () => {}
    const restoreSnapshot = vi.fn(
      () =>
        new Promise<{ restored: boolean }>((resolve) => {
          finish = resolve
        })
    )
    fakeBridge({
      db: { snapshots: vi.fn().mockResolvedValue([snapshot, olderSnapshot]), restoreSnapshot }
    })

    renderUtilities()
    await screen.findByText('Schema v26 → v27')
    fireEvent.click(restoreButtonFor(snapshot.fileName))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))

    // A shared flag would put "Restoring..." on both rows and read as two
    // restores running over one database.
    await waitFor(() =>
      expect(restoreButtonFor(snapshot.fileName).textContent).toBe('Restoring...')
    )
    expect(restoreButtonFor(olderSnapshot.fileName).textContent).toBe('Restore')

    finish({ restored: true })
    await waitFor(() => expect(screen.queryByText('Restoring...')).toBeNull())
  })

  it('shows the failure the main process reported when a restore fails', async () => {
    const restoreSnapshot = vi
      .fn()
      .mockRejectedValue(new Error('The snapshot could not be restored. See the log for details.'))
    fakeBridge({ db: { snapshots: vi.fn().mockResolvedValue([snapshot]), restoreSnapshot } })

    renderUtilities()
    await screen.findByText('Schema v26 → v27')
    fireEvent.click(restoreButtonFor(snapshot.fileName))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Restore' }))

    expect(
      await screen.findByText('The snapshot could not be restored. See the log for details.')
    ).toBeDefined()
    // And the card is usable again rather than stuck on the row that failed.
    expect(restoreButtonFor(snapshot.fileName).textContent).toBe('Restore')
  })
})
