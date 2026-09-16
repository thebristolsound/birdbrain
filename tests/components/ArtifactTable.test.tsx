// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ArtifactTable } from '@renderer/components/data/ArtifactTable'
import { ArtifactTabs } from '@renderer/components/data/ArtifactTabs'
import { toArtifactRow } from '@renderer/components/data/dataTableModel'
import { INVENTORY, STAGED_PDF } from '../renderer/dataFixtures'

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
