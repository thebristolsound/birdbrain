// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DbTables } from '@renderer/components/settings/db/DbTables'
import { queryKeys } from '@renderer/lib/api/keys'
import { fakeBridge } from '../renderer/fakeBridge'

const COLUMNS = [
  { name: 'id', type: 'TEXT', pk: true },
  { name: 'name', type: 'TEXT', pk: false }
]

// Two pages of one row each, so the pager is live and every row is identifiable
// by the offset that produced it.
function pageAt(offset: number) {
  return { rows: [{ id: `row-${offset}`, name: `name-${offset}` }], total: 100, columns: COLUMNS }
}

let db: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  db = {
    tableRows: vi.fn(async ({ offset }: { offset: number }) => pageAt(offset)),
    deleteRow: vi.fn().mockResolvedValue(true)
  }
  fakeBridge({ db })
})

afterEach(() => {
  cleanup()
})

function renderTables() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  render(<DbTables />, { wrapper })
  return { client }
}

function nextPage() {
  fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
}

async function failADelete(message: string) {
  db.deleteRow.mockRejectedValueOnce(new Error(message))
  fireEvent.click(screen.getByTitle('Delete'))
  const dialog = await screen.findByRole('dialog')
  fireEvent.click(within(dialog).getByText('Delete'))
  expect(await screen.findByText(message)).toBeDefined()
}

describe('DbTables', () => {
  it('keeps the rows and the pager on screen while the next page loads', async () => {
    renderTables()
    expect(await screen.findByText('row-0')).toBeDefined()

    // Page 2 never arrives, so everything asserted below is what the operator
    // sees for as long as the fetch is in flight.
    db.tableRows.mockReturnValueOnce(new Promise(() => {}))
    nextPage()

    // The pager is the control that was just clicked: it must not unmount from
    // under the cursor, and the rows it pages through stay put until replaced.
    expect(screen.getByText('Page 2 of 2')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDefined()
    expect(screen.getByText('row-0')).toBeDefined()
    expect(screen.queryByText('Loading...')).toBeNull()
  })

  it('clears the previous table when a different table is selected', async () => {
    renderTables()
    expect(await screen.findByText('row-0')).toBeDefined()

    db.tableRows.mockReturnValueOnce(new Promise(() => {}))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'notes' } })

    // Different columns, so holding the old rows would put one table's data
    // under another's headings.
    await waitFor(() => expect(screen.queryByText('row-0')).toBeNull())
    expect(screen.getByText('Loading...')).toBeDefined()
  })

  it('deletes the row it was asked to delete', async () => {
    renderTables()
    expect(await screen.findByText('row-0')).toBeDefined()

    fireEvent.click(screen.getByTitle('Delete'))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByText('Delete'))

    await waitFor(() =>
      expect(db.deleteRow).toHaveBeenCalledWith({ table: 'cases', pk: { id: 'row-0' } })
    )
  })

  it('drops a write-failure banner once the page it accuses is off screen', async () => {
    renderTables()
    expect(await screen.findByText('row-0')).toBeDefined()
    await failADelete('FOREIGN KEY constraint failed')

    nextPage()

    // The row the message named is no longer displayed, so neither is the
    // message.
    await waitFor(() => expect(screen.queryByText('FOREIGN KEY constraint failed')).toBeNull())
  })

  it('shows a live read failure ahead of an earlier write failure', async () => {
    const { client } = renderTables()
    expect(await screen.findByText('row-0')).toBeDefined()
    await failADelete('delete blew up')

    // Something else in the app invalidates the browse pages — DbUtilities
    // purging archived cases, say — and the refetch fails.
    db.tableRows.mockRejectedValue(new Error('no such table: cases'))
    await act(async () => {
      await client.invalidateQueries({ queryKey: queryKeys.dbTableRowsAll })
    })

    // "Delete failed" would point the operator at the wrong problem when the
    // table cannot be listed at all.
    expect(await screen.findByText('no such table: cases')).toBeDefined()
    expect(screen.queryByText('delete blew up')).toBeNull()
  })
})
