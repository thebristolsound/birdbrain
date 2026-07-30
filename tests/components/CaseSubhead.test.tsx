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
import { fakeBridge } from '../renderer/fakeBridge'

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
    fakeBridge({
      onArchiveProgress,
      shell: { showItemInFolder }
    })
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
