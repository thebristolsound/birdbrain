// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Selector } from '@shared/types'
import { BulkImportDrawer } from '@renderer/components/signals/BulkImportDrawer'
import { fakeBridge } from '../renderer/fakeBridge'

function renderDrawer(existing: Selector[] = []) {
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(<BulkImportDrawer caseId="case-1" existingSelectors={existing} onClose={onClose} />, {
    wrapper: Wrapper
  })
  return { onClose }
}

function paste(value: string) {
  fireEvent.change(screen.getByTestId('bulk-add-textarea'), { target: { value } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('BulkImportDrawer', () => {
  // A pasted list is operator-authored — nothing traces back to a capture — so
  // every item carries 'manual' (#395). Per item, not per request.
  it('stamps every pasted pattern as added by hand', async () => {
    const bulkCreate = vi.fn(async () => [])
    fakeBridge({ selectors: { bulkCreate } })
    const { onClose } = renderDrawer()

    paste('alpha\n\nbeta\n')
    fireEvent.click(screen.getByTestId('bulk-add-submit'))

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(bulkCreate).toHaveBeenCalledWith({
      caseId: 'case-1',
      selectors: [
        { pattern: 'alpha', isRegex: false, origin: 'manual' },
        { pattern: 'beta', isRegex: false, origin: 'manual' }
      ]
    })
  })

  it('keeps the origin alongside the regex flag', async () => {
    const bulkCreate = vi.fn(async () => [])
    fakeBridge({ selectors: { bulkCreate } })
    renderDrawer()

    paste('alpha')
    fireEvent.click(screen.getByTestId('bulk-add-regex-toggle'))
    fireEvent.click(screen.getByTestId('bulk-add-submit'))

    await waitFor(() => expect(bulkCreate).toHaveBeenCalledOnce())
    expect(bulkCreate).toHaveBeenCalledWith({
      caseId: 'case-1',
      selectors: [{ pattern: 'alpha', isRegex: true, origin: 'manual' }]
    })
  })

  // The live counts are the capability the redesign must not drop: they answer
  // "how much of this feed does the case already hold?" before the import runs.
  it('reports new, duplicate and blank counts as the paste is typed', () => {
    fakeBridge()
    renderDrawer()

    paste('alpha\nbeta\n\ngamma\nalpha\n')

    expect(screen.getByTestId('bulk-add-new-count').textContent).toBe('3')
    expect(screen.getByTestId('bulk-add-dup-count').textContent).toBe('1')
    expect(screen.getByTestId('bulk-add-blank-count').textContent).toBe('2')
  })

  it('counts a pattern the case already holds as a duplicate and disables import', () => {
    fakeBridge()
    renderDrawer([
      {
        id: 's1',
        caseId: 'case-1',
        pattern: 'alpha',
        isRegex: false,
        enabled: true,
        createdAt: '2026-08-01T00:00:00.000Z'
      }
    ])

    paste('alpha')

    expect(screen.getByTestId('bulk-add-new-count').textContent).toBe('0')
    expect(screen.getByTestId('bulk-add-dup-count').textContent).toBe('1')
    expect(screen.getByTestId('bulk-add-submit')).toHaveProperty('disabled', true)
  })

  it('does nothing on an empty paste', () => {
    const bulkCreate = vi.fn(async () => [])
    fakeBridge({ selectors: { bulkCreate } })
    renderDrawer()

    fireEvent.click(screen.getByTestId('bulk-add-submit'))

    expect(bulkCreate).not.toHaveBeenCalled()
  })

  it('closes without importing on Cancel', () => {
    const bulkCreate = vi.fn(async () => [])
    fakeBridge({ selectors: { bulkCreate } })
    const { onClose } = renderDrawer()

    paste('alpha')
    fireEvent.click(screen.getByText('Cancel'))

    expect(onClose).toHaveBeenCalledOnce()
    expect(bulkCreate).not.toHaveBeenCalled()
  })
})
