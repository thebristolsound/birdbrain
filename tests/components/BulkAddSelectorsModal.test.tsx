// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { BulkAddSelectorsModal } from '@renderer/components/selectors/BulkAddSelectorsModal'
import { fakeBridge } from '../renderer/fakeBridge'

function renderModal() {
  const onCreated = vi.fn()
  const onClose = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  render(
    <BulkAddSelectorsModal
      caseId="case-1"
      existingSelectors={[]}
      onClose={onClose}
      onCreated={onCreated}
    />,
    { wrapper: Wrapper }
  )
  return { onCreated, onClose }
}

function paste(value: string) {
  fireEvent.change(screen.getByTestId('bulk-add-textarea'), { target: { value } })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('BulkAddSelectorsModal', () => {
  // A pasted list is operator-authored — nothing here traces back to a capture
  // — so every item carries 'manual' (#395). Per item, not per request: the
  // bulk channel's shape stamps each row on its own.
  it('stamps every pasted pattern as added by hand', async () => {
    const bulkCreate = vi.fn(async () => [])
    fakeBridge({ selectors: { bulkCreate } })
    const { onCreated } = renderModal()

    paste('alpha\n\nbeta\n')
    fireEvent.click(screen.getByTestId('bulk-add-submit'))

    await waitFor(() => expect(onCreated).toHaveBeenCalledOnce())
    expect(bulkCreate).toHaveBeenCalledWith({
      caseId: 'case-1',
      selectors: [
        { pattern: 'alpha', isRegex: false, label: undefined, origin: 'manual' },
        { pattern: 'beta', isRegex: false, label: undefined, origin: 'manual' }
      ]
    })
  })

  it('keeps the origin alongside a label prefix and the regex flag', async () => {
    const bulkCreate = vi.fn(async () => [])
    fakeBridge({ selectors: { bulkCreate } })
    renderModal()

    paste('alpha')
    fireEvent.click(screen.getByTestId('bulk-add-regex-toggle'))
    fireEvent.change(screen.getByTestId('bulk-add-label-prefix'), { target: { value: 'Batch' } })
    fireEvent.click(screen.getByTestId('bulk-add-submit'))

    await waitFor(() => expect(bulkCreate).toHaveBeenCalledOnce())
    expect(bulkCreate).toHaveBeenCalledWith({
      caseId: 'case-1',
      selectors: [{ pattern: 'alpha', isRegex: true, label: 'Batch 1', origin: 'manual' }]
    })
  })
})
