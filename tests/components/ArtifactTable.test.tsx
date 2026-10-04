// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { ArtifactTable } from '@renderer/components/data/ArtifactTable'
import { ArtifactTabs } from '@renderer/components/data/ArtifactTabs'
import { toArtifactRow } from '@renderer/components/data/dataTableModel'
import {
  CAPTURE_A,
  CAPTURE_A_CAPTURED_AT,
  INVENTORY,
  STAGED_PDF,
  THUMB_A
} from '../renderer/dataFixtures'

afterEach(() => cleanup())

describe('ArtifactTable staging actions', () => {
  it('runs Commit and Discard for the row without selecting it', () => {
    const commit = vi.fn()
    const discard = vi.fn()
    const onSelect = vi.fn()
    render(
      <ArtifactTable
        rows={[toArtifactRow(STAGED_PDF, INVENTORY, new Map())]}
        selectedId={null}
        onSelect={onSelect}
        stagingActions={{ commit, discard, pending: false }}
        emptyMessage="none"
      />
    )
    fireEvent.click(screen.getByTestId('staging-commit-staged-1'))
    fireEvent.click(screen.getByTestId('staging-discard-staged-1'))
    expect(commit).toHaveBeenCalledWith('staged-1')
    expect(discard).toHaveBeenCalledWith('staged-1')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('holds both buttons while an action is pending', () => {
    render(
      <ArtifactTable
        rows={[toArtifactRow(STAGED_PDF, INVENTORY, new Map())]}
        selectedId={null}
        onSelect={vi.fn()}
        stagingActions={{ commit: vi.fn(), discard: vi.fn(), pending: true }}
        emptyMessage="none"
      />
    )
    expect((screen.getByTestId('staging-commit-staged-1') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('staging-discard-staged-1') as HTMLButtonElement).disabled).toBe(
      true
    )
  })

  it('shows the empty message when there are no rows', () => {
    render(
      <ArtifactTable rows={[]} selectedId={null} onSelect={vi.fn()} emptyMessage="Nothing here." />
    )
    expect(screen.getByText('Nothing here.')).toBeTruthy()
  })
})

describe('ArtifactTable selection (#1552)', () => {
  const rows = [CAPTURE_A, THUMB_A].map((row) => toArtifactRow(row, INVENTORY, new Map()))

  it('toggles the multi-selection on a modifier-click and selects on a plain click', () => {
    const onSelect = vi.fn()
    const onToggleMulti = vi.fn()
    render(
      <ArtifactTable
        rows={rows}
        selectedId={null}
        onSelect={onSelect}
        onToggleMulti={onToggleMulti}
        emptyMessage="none"
      />
    )
    fireEvent.click(screen.getByTestId('artifact-row-cap-a'), { metaKey: true })
    fireEvent.click(screen.getByTestId('artifact-row-thumb-a'), { ctrlKey: true })
    expect(onToggleMulti.mock.calls).toEqual([['cap-a'], ['thumb-a']])
    expect(onSelect).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('artifact-row-cap-a'))
    expect(onSelect).toHaveBeenCalledWith('cap-a')
  })

  it('marks the selected and the multi-selected rows with the accent bar', () => {
    render(
      <ArtifactTable
        rows={rows}
        selectedId="cap-a"
        onSelect={vi.fn()}
        multiSelectedIds={new Set(['thumb-a'])}
        emptyMessage="none"
      />
    )
    const selected = screen.getByTestId('artifact-row-cap-a')
    const multi = screen.getByTestId('artifact-row-thumb-a')
    expect(selected.className).toContain('border-l-accent')
    expect(selected.className).toContain('bg-accent-subtle')
    expect(selected.getAttribute('data-multi-selected')).toBeNull()
    expect(multi.className).toContain('border-l-accent')
    expect(multi.getAttribute('data-multi-selected')).toBe('true')
    expect(multi.getAttribute('aria-selected')).toBe('true')
  })

  it('without a toggle handler a modifier-click is a plain select', () => {
    const onSelect = vi.fn()
    render(<ArtifactTable rows={rows} selectedId={null} onSelect={onSelect} emptyMessage="none" />)
    fireEvent.click(screen.getByTestId('artifact-row-cap-a'), { ctrlKey: true })
    expect(onSelect).toHaveBeenCalledWith('cap-a')
    expect(screen.getByTestId('artifact-row-thumb-a').className).toContain('border-l-transparent')
  })
})

describe('ArtifactTable keyboard reach (#1537)', () => {
  const rows = [CAPTURE_A, THUMB_A].map((row) => toArtifactRow(row, INVENTORY, new Map()))

  it('keeps one Tab stop and moves between rows with the arrow, Home and End keys', () => {
    render(
      <ArtifactTable rows={rows} selectedId="thumb-a" onSelect={vi.fn()} emptyMessage="none" />
    )
    const first = screen.getByTestId('artifact-row-cap-a')
    const second = screen.getByTestId('artifact-row-thumb-a')
    expect(first.tabIndex).toBe(-1)
    expect(second.tabIndex).toBe(0)

    second.focus()
    fireEvent.keyDown(second, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(second)
    fireEvent.keyDown(second, { key: 'Home' })
    expect(document.activeElement).toBe(first)
    fireEvent.keyDown(first, { key: 'End' })
    expect(document.activeElement).toBe(second)
    // The Tab stop follows focus rather than staying on the selected row.
    fireEvent.keyDown(second, { key: 'Home' })
    expect(first.tabIndex).toBe(0)
    expect(second.tabIndex).toBe(-1)
  })

  it("keeps the staged row's Commit and Discard inside the grid keyboard model", () => {
    const staged = [toArtifactRow(STAGED_PDF, INVENTORY, new Map()), ...rows]
    const onOpen = vi.fn()
    render(
      <ArtifactTable
        rows={staged}
        selectedId={null}
        onSelect={vi.fn()}
        onOpen={onOpen}
        stagingActions={{ commit: vi.fn(), discard: vi.fn(), pending: false }}
        emptyMessage="none"
      />
    )
    const row = screen.getByTestId('artifact-row-staged-1')
    const commit = screen.getByTestId('staging-commit-staged-1')
    const discard = screen.getByTestId('staging-discard-staged-1')
    expect(commit.tabIndex).toBe(-1)
    expect(discard.tabIndex).toBe(-1)

    row.focus()
    fireEvent.keyDown(row, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(row)
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(commit)
    fireEvent.keyDown(commit, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(discard)
    fireEvent.keyDown(discard, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(discard)
    fireEvent.keyDown(discard, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(commit)
    fireEvent.keyDown(commit, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(row)

    // Down from a control leaves for the next row; Enter on a control is the
    // control's, not an open.
    fireEvent.keyDown(commit, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByTestId('artifact-row-cap-a'))
    fireEvent.keyDown(commit, { key: 'Enter' })
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('declares grid semantics, since rows are selectable', () => {
    render(<ArtifactTable rows={rows} selectedId={null} onSelect={vi.fn()} emptyMessage="none" />)
    const table = screen.getByRole('grid', { name: 'Artifacts' })
    expect(within(table).getAllByRole('columnheader').length).toBe(6)
    expect(within(table).getAllByRole('row').length).toBe(3)
    expect(screen.getByTestId('artifact-row-cap-a').tabIndex).toBe(0)
  })
})

describe('ArtifactTable CAPTURED cell (#1552)', () => {
  it('shows a capture time bare and names any other clock on the cell', () => {
    const facts = new Map([['cap-a', { capturedAt: CAPTURE_A_CAPTURED_AT }]])
    render(
      <ArtifactTable
        rows={[CAPTURE_A, THUMB_A, STAGED_PDF].map((row) => toArtifactRow(row, INVENTORY, facts))}
        selectedId={null}
        onSelect={vi.fn()}
        emptyMessage="none"
      />
    )
    for (const id of ['cap-a', 'thumb-a']) {
      const row = screen.getByTestId(`artifact-row-${id}`)
      expect(row.textContent).toContain('2026-09-01 09:58')
      expect(screen.queryByTestId(`captured-clock-${id}`)).toBeNull()
      expect(within(row).getByTitle('Captured 2026-09-01T09:58:12.000Z')).toBeTruthy()
    }
    expect(screen.getByTestId('artifact-row-staged-1').textContent).toContain('2026-09-10 12:00')
    expect(screen.getByTestId('captured-clock-staged-1').textContent).toBe('arrived')
  })
})

describe('ArtifactTabs', () => {
  it('switches tabs and shows the active tab’s hint', () => {
    render(
      <ArtifactTabs
        title="file"
        subtitle="path"
        tabs={[
          { id: 'a', label: 'Alpha', hint: 'first', content: <p>alpha body</p> },
          { id: 'b', label: 'Beta', hint: 'second', content: <p>beta body</p> }
        ]}
      />
    )
    expect(screen.getByText('alpha body')).toBeTruthy()
    expect(screen.getByText('first')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Beta' }))
    expect(screen.getByText('beta body')).toBeTruthy()
    expect(screen.getByText('second')).toBeTruthy()
    expect(screen.queryByText('alpha body')).toBeNull()
  })

  it('follows the leading tab until one is picked, then keeps the pick while it exists', () => {
    const tab = (id: string) => ({ id, label: id, content: <p>{id} body</p> })
    const { rerender } = render(
      <ArtifactTabs title="file" subtitle="path" tabs={[tab('b'), tab('c')]} />
    )
    expect(screen.getByText('b body')).toBeTruthy()
    // A tab arriving ahead of the others becomes the one shown.
    rerender(<ArtifactTabs title="file" subtitle="path" tabs={[tab('a'), tab('b'), tab('c')]} />)
    expect(screen.getByText('a body')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'c' }))
    rerender(<ArtifactTabs title="file" subtitle="path" tabs={[tab('a'), tab('c')]} />)
    expect(screen.getByText('c body')).toBeTruthy()
    // A picked tab the row does not have falls back to the leading one.
    rerender(<ArtifactTabs title="file" subtitle="path" tabs={[tab('a'), tab('b')]} />)
    expect(screen.getByText('a body')).toBeTruthy()
  })
})
