// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { ArchiveInspectReport } from '@shared/types'

const navigateSpy = vi.fn()
const importMutateSpy = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy
}))

vi.mock('@renderer/lib/queries', () => ({
  useCasesMutations: () => ({
    importArchive: { mutateAsync: importMutateSpy, isPending: false }
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
            return React.createElement(tag, { ...domProps, ref }, children)
          }
        )
    }
  )

  return {
    motion,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => children
  }
})

import { ImportCaseDialog } from '@renderer/components/cases/ImportCaseDialog'

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

describe('ImportCaseDialog', () => {
  beforeEach(() => {
    navigateSpy.mockClear()
    importMutateSpy.mockReset()
    importMutateSpy.mockResolvedValue({ newCaseId: 'case-new-1' })
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
