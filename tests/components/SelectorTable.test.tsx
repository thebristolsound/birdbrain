// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { Selector } from '@shared/types'
import { SelectorTable } from '@renderer/components/selectors/SelectorTable'
import { fakeBridge } from '../renderer/fakeBridge'

const selector: Selector = {
  id: 's1',
  caseId: 'case-1',
  pattern: 'acme',
  isRegex: false,
  enabled: true,
  createdAt: '2026-08-01T00:00:00.000Z'
}

function renderTable(onRefresh = vi.fn()) {
  render(
    <SelectorTable
      selectors={[selector]}
      matchCounts={{ s1: 4 }}
      onRefresh={onRefresh}
      caseId="case-1"
    />
  )
  return { onRefresh }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SelectorTable', () => {
  it('flips the enabled flag and asks the owner to refresh', async () => {
    const update = vi.fn(async () => ({ ...selector, enabled: false }))
    fakeBridge({ selectors: { update } })
    const { onRefresh } = renderTable()

    fireEvent.click(screen.getByRole('switch'))

    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
    expect(update).toHaveBeenCalledWith({ id: 's1', enabled: false })
  })

  it('deletes by id and asks the owner to refresh', async () => {
    const remove = vi.fn(async () => true)
    fakeBridge({ selectors: { delete: remove } })
    const { onRefresh } = renderTable()

    fireEvent.click(screen.getByTitle('Delete'))

    await waitFor(() => expect(onRefresh).toHaveBeenCalledOnce())
    expect(remove).toHaveBeenCalledWith('s1')
  })

  it('expands a match-preview row under the selector it belongs to', async () => {
    fakeBridge({
      captures: { list: vi.fn(async () => []) },
      selectors: { matchingCaptures: vi.fn(async () => []) }
    })
    renderTable()

    fireEvent.click(screen.getByTitle('Test matches'))

    const panel = await screen.findByText('No match previews available.')
    expect(panel.closest('td')?.getAttribute('colspan')).toBe('7')
  })

  it('filters the listed selectors without touching the bridge', () => {
    fakeBridge()
    renderTable()

    fireEvent.change(screen.getByPlaceholderText('Filter selectors...'), {
      target: { value: 'nothing-matches' }
    })

    expect(screen.queryByRole('switch')).toBeNull()
  })
})
