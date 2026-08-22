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

function renderTable(onRefresh = vi.fn(), only: Selector = selector) {
  const { container } = render(
    <SelectorTable
      selectors={[only]}
      matchCounts={{ s1: 4 }}
      onRefresh={onRefresh}
      caseId="case-1"
    />
  )
  return { container, onRefresh }
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
    const { container } = renderTable()

    // Assert absence first: without this the test would also pass against a row that
    // renders the preview panel unconditionally, which is the thing it claims to prove.
    expect(screen.queryByText('No match previews available.')).toBeNull()
    expect(container.querySelector('td[colspan="7"]')).toBeNull()

    fireEvent.click(screen.getByTitle('Test matches'))

    const panel = await screen.findByText('No match previews available.')
    expect(panel.closest('td')?.getAttribute('colspan')).toBe('7')
  })

  // The four labels are fixed by the design (#395) — assert the exact copy, not a
  // substring, so a reworded pill has to revisit the ruling.
  it.each([
    ['extension', 'Added from the extension'],
    ['capture', 'Added from a capture'],
    ['note', 'Added from a note'],
    ['manual', 'Added by hand']
  ] as const)('names %s provenance in the expanded detail', async (origin, label) => {
    fakeBridge({
      captures: { list: vi.fn(async () => []) },
      selectors: { matchingCaptures: vi.fn(async () => []) }
    })
    renderTable(vi.fn(), { ...selector, origin })

    fireEvent.click(screen.getByTitle('Test matches'))

    const pill = await screen.findByTestId('selector-origin')
    expect(pill.textContent).toBe(label)
  })

  // NULL means the selector predates provenance recording, and a legacy row has
  // nothing to state — so it renders nothing rather than guessing 'manual'.
  it('renders no provenance for a selector that has no origin', async () => {
    fakeBridge({
      captures: { list: vi.fn(async () => []) },
      selectors: { matchingCaptures: vi.fn(async () => []) }
    })
    renderTable()

    fireEvent.click(screen.getByTitle('Test matches'))

    await screen.findByText('No match previews available.')
    expect(screen.queryByTestId('selector-origin')).toBeNull()
    for (const label of [
      'Added from the extension',
      'Added from a capture',
      'Added from a note',
      'Added by hand'
    ]) {
      expect(screen.queryByText(label)).toBeNull()
    }
  })

  // jsdom does not lay out, so this pins the class contract that keeps --d-row in
  // control (#421): only the two wrapping cells carry vertical padding, and the
  // regex chip carries none — a py on the fixed-height cells or on the chip pushes
  // the row past compact's 26px and hands the height back to content.
  it('lets --d-row set the row height: only the wrapping cells carry vertical padding', () => {
    fakeBridge()
    const regex: Selector = { ...selector, id: 's2', pattern: 'acmeregex', isRegex: true }
    render(
      <SelectorTable
        selectors={[selector, regex]}
        matchCounts={{}}
        onRefresh={vi.fn()}
        caseId="case-1"
      />
    )

    const rows = screen.getAllByRole('row').filter((r) => r.querySelector('td'))
    expect(rows).toHaveLength(2)
    for (const row of rows) {
      expect(row.className).toContain('h-[var(--d-row)]')
      const cells = [...row.querySelectorAll('td')]
      expect(cells).toHaveLength(7)
      const padded = cells.map((td) => /\bpy-/.test(td.className))
      // on, pattern, type, label, matches, filter, actions
      expect(padded).toEqual([false, true, false, true, false, false, false])
    }

    const chip = screen.getByText('acmeregex').closest('span.inline-block')
    expect(chip).not.toBeNull()
    expect(chip?.className).not.toMatch(/\bpy-/)
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
