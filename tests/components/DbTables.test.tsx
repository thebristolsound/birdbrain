// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { DbTables } from '@renderer/components/settings/db/DbTables'
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
  return render(<DbTables />, { wrapper: withClient(client) })
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
    // The held page stops at the table boundary: rows from the table you just
    // left, rendered under the new table's headings, would be a misread rather
    // than a stale read — the column set is different.
    expect(screen.queryByText('cases-row')).toBeNull()
    expect(screen.getByText('Loading...')).toBeDefined()
  })
})
