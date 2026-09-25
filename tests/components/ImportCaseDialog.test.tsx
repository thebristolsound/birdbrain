// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import type { ArchiveInspectReport } from '@shared/types'
import type { ArchiveProgressEvent } from '@shared/ipc'

const navigateSpy = vi.fn()
const importMutateSpy = vi.fn()
let importIsPending = false

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy
}))

vi.mock('@renderer/lib/queries', () => ({
  useCasesMutations: () => ({
    importArchive: { mutateAsync: importMutateSpy, get isPending() { return importIsPending } }
  })
}))

vi.mock('motion/react', async () => {
  const React = await import('react')
  const motion = new Proxy(
    {},
    {
      get: (_, tag: string) =>
        React.forwardRef<HTMLElement, Record<string, unknown> & { children?: React.ReactNode }>(
          ({ children, ...props }, ref) => {
            const {
              initial,
              animate,
              exit,
              transition,
              whileTap,
              whileHover,
              layout,
              ...domProps
            } = props
            void initial
            void animate
            void exit
            void transition
            void whileTap
            void whileHover
            void layout
            // forwardRef wraps P in PropsWithoutRef, which collapses an index-signature
            // props type through Omit and widens children to unknown. Narrow it back.
            return React.createElement(tag, { ...domProps, ref }, children as React.ReactNode)
          }
        )
    }
  )

  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children
  }
})

import { ImportCaseDialog } from '@renderer/components/dashboard/cases/ImportCaseDialog'
import { fakeBridge } from '../renderer/fakeBridge'

function makeReport(overrides: Partial<ArchiveInspectReport> = {}): ArchiveInspectReport {
  return {
    archivePath: '/tmp/case.birdbrain',
    schemaVersion: 12,
    exportedAt: '2026-06-01T00:00:00.000Z',
    toolVersion: '1.0.1',
    caseName: 'Op Nightshade',
    caseDescription: 'Investigation into shell companies',
    sourceInstallationId: 'inst-abc123',
    sourceOperatorName: 'Jane Investigator',
    counts: {
      captures: 42,
      notes: 3,
      tags: 5,
      selectors: 2,
      annotations: 1,
      extractedData: 7,
      archiveRefs: 0
    },
    verification: {
      overallValid: true,
      chainValid: true,
      artifactCount: 42,
      artifactFailureCount: 0,
      captureCount: 42,
      captureHashFailureCount: 0
    },
    ...overrides
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('ImportCaseDialog', () => {
  let onArchiveProgress: ReturnType<typeof vi.fn>
  let progressCb: ((event: ArchiveProgressEvent) => void) | null

  beforeEach(() => {
    navigateSpy.mockClear()
    importMutateSpy.mockReset()
    importMutateSpy.mockResolvedValue({ newCaseId: 'case-new-1' })
    importIsPending = false
    progressCb = null
    onArchiveProgress = vi.fn((cb: (event: ArchiveProgressEvent) => void) => {
      progressCb = cb
      return vi.fn()
    })
    fakeBridge({ onArchiveProgress })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows case name and archive counts', () => {
    render(<ImportCaseDialog report={makeReport()} onClose={vi.fn()} />)

    expect(screen.getByText('Op Nightshade')).toBeDefined()
    expect(screen.getByText('42')).toBeDefined()
    expect(screen.getByText('Captures')).toBeDefined()
  })

  it('shows the archive refs count', () => {
    render(<ImportCaseDialog report={makeReport({ counts: { ...makeReport().counts, archiveRefs: 4 } })} onClose={vi.fn()} />)

    expect(screen.getByText('Archive refs')).toBeDefined()
    expect(screen.getByText('4')).toBeDefined()
  })

  it('renders the live step and percent from archive progress events during import', async () => {
    const gate = deferred<{ newCaseId: string }>()
    importMutateSpy.mockImplementation(() => {
      importIsPending = true
      return gate.promise
    })
    const { rerender } = render(<ImportCaseDialog report={makeReport()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Import case'))
    rerender(<ImportCaseDialog report={makeReport()} onClose={vi.fn()} />)

    await waitFor(() => expect(onArchiveProgress).toHaveBeenCalled())

    act(() => {
      progressCb?.({ step: 'Writing captures...', percent: 45 })
    })

    expect(await screen.findByText('Writing captures...')).toBeDefined()
    expect(screen.getByText('45%')).toBeDefined()

    importIsPending = false
    gate.resolve({ newCaseId: 'case-new-1' })
  })

  it('ignores progress events that carry a caseId (those belong to export)', async () => {
    const gate = deferred<{ newCaseId: string }>()
    importMutateSpy.mockImplementation(() => {
      importIsPending = true
      return gate.promise
    })
    const { rerender } = render(<ImportCaseDialog report={makeReport()} onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Import case'))
    rerender(<ImportCaseDialog report={makeReport()} onClose={vi.fn()} />)

    await waitFor(() => expect(onArchiveProgress).toHaveBeenCalled())

    act(() => {
      progressCb?.({ caseId: 'some-case', step: 'Should not show', percent: 99 })
    })

    expect(screen.queryByText('Should not show')).toBeNull()

    importIsPending = false
    gate.resolve({ newCaseId: 'case-new-1' })
  })

  it('shows a green banner when the archive is verified', () => {
    render(<ImportCaseDialog report={makeReport()} onClose={vi.fn()} />)

    expect(screen.getByText('Archive verified')).toBeDefined()
    expect(screen.queryByText('Verification failed')).toBeNull()
  })

  it('disables import for a failing report until the override checkbox is ticked', () => {
    const report = makeReport({
      verification: {
        overallValid: false,
        chainValid: false,
        chainReason: 'signature mismatch',
        artifactCount: 42,
        artifactFailureCount: 2,
        captureCount: 42,
        captureHashFailureCount: 1
      }
    })
    render(<ImportCaseDialog report={report} onClose={vi.fn()} />)

    expect(screen.getByText('Verification failed')).toBeDefined()
    expect(screen.getByText(/signature mismatch/)).toBeDefined()
    expect(screen.getByText(/2 artifacts failed hash verification/)).toBeDefined()
    expect(screen.getByText(/1 capture failed hash verification/)).toBeDefined()

    expect((screen.getByText('Import case') as HTMLButtonElement).disabled).toBe(true)

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement
    fireEvent.click(checkbox)

    expect((screen.getByText('Import case') as HTMLButtonElement).disabled).toBe(false)
  })

  it('confirms with overrideTamper true for a failing report after override', async () => {
    const onClose = vi.fn()
    const report = makeReport({
      verification: {
        overallValid: false,
        chainValid: false,
        chainReason: 'signature mismatch',
        artifactCount: 42,
        artifactFailureCount: 2,
        captureCount: 42,
        captureHashFailureCount: 1
      }
    })
    render(<ImportCaseDialog report={report} onClose={onClose} />)

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByText('Import case'))

    await waitFor(() =>
      expect(importMutateSpy).toHaveBeenCalledWith({
        archivePath: '/tmp/case.birdbrain',
        overrideTamper: true
      })
    )
    await waitFor(() =>
      expect(navigateSpy).toHaveBeenCalledWith({
        to: '/cases/$caseId',
        params: { caseId: 'case-new-1' }
      })
    )
    expect(onClose).toHaveBeenCalled()
  })

  it('imports a verified report with overrideTamper false and navigates to the new case', async () => {
    const onClose = vi.fn()
    render(<ImportCaseDialog report={makeReport()} onClose={onClose} />)

    fireEvent.click(screen.getByText('Import case'))

    await waitFor(() =>
      expect(importMutateSpy).toHaveBeenCalledWith({
        archivePath: '/tmp/case.birdbrain',
        overrideTamper: false
      })
    )
    expect(navigateSpy).toHaveBeenCalledWith({
      to: '/cases/$caseId',
      params: { caseId: 'case-new-1' }
    })
    expect(onClose).toHaveBeenCalled()
  })

  it('surfaces an error without closing the dialog', async () => {
    importMutateSpy.mockRejectedValueOnce(new Error('disk full'))
    const onClose = vi.fn()
    render(<ImportCaseDialog report={makeReport()} onClose={onClose} />)

    fireEvent.click(screen.getByText('Import case'))

    expect(await screen.findByText(/disk full/)).toBeDefined()
    expect(onClose).not.toHaveBeenCalled()
  })
})

// Focus, Tab and Escape only (#1536). The tamper override and the import call
// are pinned above; these pin that the keyboard reaches neither by accident.
describe('ImportCaseDialog keyboard', () => {
  const failing = {
    overallValid: false,
    chainValid: false,
    chainReason: 'signature mismatch',
    artifactCount: 42,
    artifactFailureCount: 2,
    captureCount: 42,
    captureHashFailureCount: 1
  }

  beforeEach(() => {
    importMutateSpy.mockReset()
    importIsPending = false
    fakeBridge({ onArchiveProgress: vi.fn(() => vi.fn()) })
  })

  afterEach(() => {
    cleanup()
  })

  it('is a modal dialog named by its heading', () => {
    render(<ImportCaseDialog report={makeReport()} onClose={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: 'Import Case Archive' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
  })

  it('lands on Cancel, not on the tamper override, when a failing archive opens', () => {
    render(<ImportCaseDialog report={makeReport({ verification: failing })} onClose={vi.fn()} />)

    expect(document.activeElement).toBe(screen.getByText('Cancel'))
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  })

  it('closes on Escape without importing', () => {
    const onClose = vi.fn()
    render(<ImportCaseDialog report={makeReport()} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(importMutateSpy).not.toHaveBeenCalled()
  })

  it('ignores Escape while an import is running, as the overlay click does', () => {
    importIsPending = true
    const onClose = vi.fn()
    render(<ImportCaseDialog report={makeReport()} onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).not.toHaveBeenCalled()
  })

  it('keeps Tab inside the panel and leaves the override unticked', () => {
    render(<ImportCaseDialog report={makeReport({ verification: failing })} onClose={vi.fn()} />)
    const cancel = screen.getByText('Cancel')
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement

    // Import case is disabled on a failing archive, so Cancel is the last stop
    // and Tab wraps round to the override, the first.
    fireEvent.keyDown(cancel, { key: 'Tab' })
    expect(document.activeElement).toBe(checkbox)

    fireEvent.keyDown(checkbox, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)
    expect(checkbox.checked).toBe(false)
  })

  it('hands focus back to the opener when the parent unmounts it', () => {
    const { rerender } = render(
      <>
        <button data-testid="opener">Import</button>
      </>
    )
    const opener = screen.getByTestId('opener')
    opener.focus()
    rerender(
      <>
        <button data-testid="opener">Import</button>
        <ImportCaseDialog report={makeReport()} onClose={vi.fn()} />
      </>
    )
    expect(document.activeElement).toBe(screen.getByText('Cancel'))

    rerender(
      <>
        <button data-testid="opener">Import</button>
      </>
    )

    expect(document.activeElement).toBe(opener)
  })
})
