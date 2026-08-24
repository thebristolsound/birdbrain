// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import type { ArchiveProgressEvent, ArchiveExportResult } from '@shared/ipc'

const updateMutateSpy = vi.fn()
const exportArchiveMutateSpy = vi.fn()
let exportArchiveIsPending = false

vi.mock('@renderer/lib/queries', () => ({
  useCasesMutations: () => ({
    update: { mutateAsync: updateMutateSpy },
    exportArchive: {
      mutateAsync: exportArchiveMutateSpy,
      get isPending() {
        return exportArchiveIsPending
      }
    }
  })
}))

vi.mock('@renderer/components/export/ExportDialog', () => ({
  ExportDialog: () => null
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

import { ExportMenu } from '@renderer/components/export/ExportMenu'
import { CaseSubhead } from '@renderer/components/overview/CaseSubhead'
import { fakeBridge } from '../renderer/fakeBridge'
import type { Case } from '@shared/types'

async function clickExportCaseFile() {
  fireEvent.click(screen.getByRole('button', { name: /Export/i }))
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Export case file' }))
}

describe('ExportMenu', () => {
  let onArchiveProgress: ReturnType<typeof vi.fn>
  let progressCb: ((event: ArchiveProgressEvent) => void) | null
  let showItemInFolder: ReturnType<typeof vi.fn>

  beforeEach(() => {
    updateMutateSpy.mockReset()
    exportArchiveMutateSpy.mockReset()
    exportArchiveIsPending = false
    progressCb = null
    onArchiveProgress = vi.fn((cb: (event: ArchiveProgressEvent) => void) => {
      progressCb = cb
      return vi.fn()
    })
    showItemInFolder = vi.fn().mockResolvedValue(undefined)
    fakeBridge({ onArchiveProgress, shell: { showItemInFolder } })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the live step and percent from archive progress events during export', async () => {
    const gate = deferred<ArchiveExportResult>()
    exportArchiveMutateSpy.mockImplementation(() => {
      exportArchiveIsPending = true
      return gate.promise
    })
    const { rerender } = render(<ExportMenu caseId="case-1" caseName="Op Nightshade" />)

    await clickExportCaseFile()
    rerender(<ExportMenu caseId="case-1" caseName="Op Nightshade" />)

    await waitFor(() => expect(onArchiveProgress).toHaveBeenCalled())

    act(() => {
      progressCb?.({ caseId: 'case-1', step: 'Bundling captures...', percent: 55 })
    })

    expect(await screen.findByText('Bundling captures... — 55%')).toBeDefined()

    exportArchiveIsPending = false
    gate.resolve({ canceled: false, filePath: 'archive.birdbrain' })
  })

  it('ignores progress events for other cases', async () => {
    const gate = deferred<ArchiveExportResult>()
    exportArchiveMutateSpy.mockImplementation(() => {
      exportArchiveIsPending = true
      return gate.promise
    })
    const { rerender } = render(<ExportMenu caseId="case-1" caseName="Op Nightshade" />)

    await clickExportCaseFile()
    rerender(<ExportMenu caseId="case-1" caseName="Op Nightshade" />)

    await waitFor(() => expect(onArchiveProgress).toHaveBeenCalled())

    act(() => {
      progressCb?.({ caseId: 'other-case', step: 'Should not show', percent: 99 })
    })

    expect(screen.queryByText(/Should not show/)).toBeNull()

    exportArchiveIsPending = false
    gate.resolve({ canceled: false, filePath: 'archive.birdbrain' })
  })

  it('shows the saved archive banner on success', async () => {
    exportArchiveMutateSpy.mockResolvedValue({
      canceled: false,
      filePath: 'archive.birdbrain'
    } satisfies ArchiveExportResult)
    render(<ExportMenu caseId="case-1" caseName="Op Nightshade" />)

    await clickExportCaseFile()

    expect(await screen.findByText('Archive saved')).toBeDefined()

    fireEvent.click(screen.getByText('Show in folder'))
    expect(showItemInFolder).toHaveBeenCalledWith('archive.birdbrain')
  })

  it('surfaces an error from a failed export', async () => {
    exportArchiveMutateSpy.mockRejectedValueOnce(new Error('disk full'))
    render(<ExportMenu caseId="case-1" caseName="Op Nightshade" />)

    await clickExportCaseFile()

    expect(await screen.findByText(/disk full/)).toBeDefined()
  })
})

describe('CaseSubhead case number (#399)', () => {
  const CASE: Case = {
    id: 'case-1',
    name: 'Op Nightshade',
    description: 'desc',
    isDemo: false,
    archived: false,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z'
  }

  beforeEach(() => {
    updateMutateSpy.mockReset()
    updateMutateSpy.mockResolvedValue(undefined)
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the case number and saves an edited value', async () => {
    render(<CaseSubhead caseData={{ ...CASE, caseNumber: 'REF-1' }} />)

    expect(screen.getByText('No. REF-1')).toBeDefined()
    fireEvent.click(screen.getByTestId('case-subhead-number-btn'))
    const input = screen.getByTestId('case-subhead-number-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'CPS 2026/114' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(updateMutateSpy).toHaveBeenCalledWith({ id: 'case-1', caseNumber: 'CPS 2026/114' })
    )
  })

  it('offers to add a case number when none is set and saves nothing on an unchanged blur', async () => {
    render(<CaseSubhead caseData={CASE} />)

    expect(screen.getByText('Add case number…')).toBeDefined()
    fireEvent.click(screen.getByTestId('case-subhead-number-btn'))
    fireEvent.blur(screen.getByTestId('case-subhead-number-input'))

    await waitFor(() => expect(screen.getByTestId('case-subhead-number-btn')).toBeDefined())
    expect(updateMutateSpy).not.toHaveBeenCalled()
  })

  it('reverts on Escape without saving', () => {
    render(<CaseSubhead caseData={{ ...CASE, caseNumber: 'REF-1' }} />)

    fireEvent.click(screen.getByTestId('case-subhead-number-btn'))
    const input = screen.getByTestId('case-subhead-number-input') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'changed' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(screen.getByText('No. REF-1')).toBeDefined()
    expect(updateMutateSpy).not.toHaveBeenCalled()
  })
})
