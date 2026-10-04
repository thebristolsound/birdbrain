// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DbTables } from '@renderer/components/settings/db/DbTables'
import { queryKeys } from '@renderer/lib/api/keys'
import { fakeBridge } from '../renderer/fakeBridge'

const columns = [
  { name: 'id', type: 'TEXT', pk: true },
  { name: 'value', type: 'TEXT', pk: false }
]

function withClient(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

function renderTables() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { ...render(<DbTables />, { wrapper: withClient(client) }), client }
}

afterEach(() => {
  cleanup()
})

describe('DbTables', () => {
  it('keeps the previous page of rows on screen while the next page is loading', async () => {
    // total: 51 with PAGE_SIZE 50 makes a second page reachable, so the Next
    // button is enabled after the first page resolves.
    const page0 = { rows: [{ id: '1', value: 'page-zero-row' }], total: 51, columns }
    let resolvePage1: (value: unknown) => void = () => {}
    const page1Pending = new Promise((resolve) => {
      resolvePage1 = resolve
    })

    const tableRows = vi.fn()
    tableRows.mockResolvedValueOnce(page0)
    tableRows.mockReturnValueOnce(page1Pending)
    fakeBridge({ db: { tableRows } })

    const { container } = renderTables()

    expect(await screen.findByText('page-zero-row')).toBeDefined()

    const nextButton = container.querySelector('svg.lucide-chevron-right')?.closest('button')
    expect(nextButton).toBeTruthy()
    fireEvent.click(nextButton!)

    await waitFor(() => expect(tableRows).toHaveBeenCalledTimes(2))
    // Confirms the page really did advance (offset 50 = page 1) while the
    // first page's row is still on screen, rather than the assertion below
    // passing merely because nothing happened.
    expect(tableRows).toHaveBeenNthCalledWith(2, { table: 'cases', offset: 50, limit: 50 })
    expect(screen.getByText('page-zero-row')).toBeDefined()

    resolvePage1({ rows: [{ id: '2', value: 'page-one-row' }], total: 51, columns })

    expect(await screen.findByText('page-one-row')).toBeDefined()
    expect(screen.queryByText('page-zero-row')).toBeNull()
  })

  it('names the table picker, the row and page buttons and the row editor fields (#1537)', async () => {
    const tableRows = vi
      .fn()
      .mockResolvedValue({ rows: [{ id: '1', value: 'only-row' }], total: 51, columns })
    fakeBridge({ db: { tableRows } })
    renderTables()
    expect(await screen.findByText('only-row')).toBeDefined()

    expect(screen.getByLabelText('Table').tagName).toBe('SELECT')
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Delete row' })).toBeDefined()

    fireEvent.click(screen.getByRole('button', { name: 'Edit row' }))
    const editor = within(screen.getByRole('dialog'))
    expect((editor.getByLabelText(/^value/) as HTMLInputElement).value).toBe('only-row')
    expect((editor.getByLabelText(/^id/) as HTMLInputElement).value).toBe('1')
  })

  it('shows nothing from the previous table while a different table loads', async () => {
    const casesPage = { rows: [{ id: '1', value: 'cases-row' }], total: 1, columns }

    const tableRows = vi.fn()
    tableRows.mockResolvedValueOnce(casesPage)
    tableRows.mockReturnValueOnce(new Promise(() => {}))
    fakeBridge({ db: { tableRows } })

    renderTables()

    expect(await screen.findByText('cases-row')).toBeDefined()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'notes' } })

    await waitFor(() =>
      expect(tableRows).toHaveBeenNthCalledWith(2, { table: 'notes', offset: 0, limit: 50 })
    )
    // The held page stops at the table boundary. Nothing marks a held frame as
    // stale — rows, headings and the row count all come from the old table's
    // result — while the selector above it already reads the new table.
    expect(screen.queryByText('cases-row')).toBeNull()
    expect(screen.getByText('Loading...')).toBeDefined()
  })

  it('shows a live read failure and a failed write at the same time', async () => {
    const page0 = { rows: [{ id: '1', value: 'only-row' }], total: 1, columns }

    const tableRows = vi.fn()
    tableRows.mockResolvedValueOnce(page0)
    tableRows.mockRejectedValue(new Error('database disk image is malformed'))
    const deleteRow = vi.fn().mockRejectedValue(new Error('FOREIGN KEY constraint failed'))
    fakeBridge({ db: { tableRows, deleteRow } })

    const { client } = renderTables()

    expect(await screen.findByText('only-row')).toBeDefined()

    await act(async () => {
      await client.invalidateQueries()
    })

    expect(await screen.findByText('database disk image is malformed')).toBeDefined()
    // A failed refetch keeps the last good rows on screen, which is what leaves
    // a row there to click while the table can no longer be read.
    expect(screen.getByText('only-row')).toBeDefined()

    fireEvent.click(screen.getByTitle('Delete'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))

    // The banner is the only surface a row write has, so suppressing it behind
    // the read error would make the failed delete produce no on-screen change
    // at all. Both stay up.
    expect(await screen.findByText('FOREIGN KEY constraint failed')).toBeDefined()
    expect(screen.getByText('database disk image is malformed')).toBeDefined()
    expect(screen.getByText('only-row')).toBeDefined()
  })

  it('keeps the write failure up across a read recovery rather than re-raising it later', async () => {
    const page0 = { rows: [{ id: '1', value: 'only-row' }], total: 1, columns }

    const tableRows = vi.fn()
    tableRows.mockResolvedValueOnce(page0)
    tableRows.mockRejectedValueOnce(new Error('database disk image is malformed'))
    tableRows.mockResolvedValue(page0)
    const deleteRow = vi.fn().mockRejectedValue(new Error('FOREIGN KEY constraint failed'))
    fakeBridge({ db: { tableRows, deleteRow } })

    const { client } = renderTables()

    expect(await screen.findByText('only-row')).toBeDefined()

    await act(async () => {
      await client.invalidateQueries()
    })
    expect(await screen.findByText('database disk image is malformed')).toBeDefined()

    fireEvent.click(screen.getByTitle('Delete'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('FOREIGN KEY constraint failed')).toBeDefined()

    // The write error is cleared only by a table/page change or a later
    // success, so holding it back during the outage would not discard it — it
    // would appear for the first time here, beside freshly loaded rows and
    // attached to a click from minutes ago. Showing it throughout is what
    // keeps it anchored to when it happened.
    await act(async () => {
      await client.invalidateQueries()
    })

    await waitFor(() => expect(screen.queryByText('database disk image is malformed')).toBeNull())
    expect(screen.getByText('FOREIGN KEY constraint failed')).toBeDefined()
  })

  it('shows one banner when the read and the write fail with the same message', async () => {
    const page0 = { rows: [{ id: '1', value: 'only-row' }], total: 1, columns }
    const malformed = 'database disk image is malformed'

    const tableRows = vi.fn()
    tableRows.mockResolvedValueOnce(page0)
    tableRows.mockRejectedValue(new Error(malformed))
    const deleteRow = vi.fn().mockRejectedValue(new Error(malformed))
    fakeBridge({ db: { tableRows, deleteRow } })

    const { client } = renderTables()

    expect(await screen.findByText('only-row')).toBeDefined()

    // Read first, then write, so both are provably live when the banners are
    // counted — asserting on the message alone would otherwise be satisfied by
    // the moment when only one of the two had arrived.
    await act(async () => {
      await client.invalidateQueries()
    })
    await waitFor(() =>
      expect(client.getQueryState(queryKeys.dbTableRows('cases', 0, 50))?.status).toBe('error')
    )

    fireEvent.click(screen.getByTitle('Delete'))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteRow).toHaveBeenCalled())
    await act(async () => {})

    // One SQLite fault broke the delete and the refetch it triggered. That is
    // one problem, and printing it twice would read as two.
    expect(screen.getAllByText(malformed)).toHaveLength(1)
  })
})
