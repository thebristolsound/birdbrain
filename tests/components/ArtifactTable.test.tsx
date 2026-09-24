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
})
