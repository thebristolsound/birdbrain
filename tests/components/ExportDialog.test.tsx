// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import type { ExportOptions, ExportPreflight } from '@shared/types'
import type { ExportProgressEvent, ExportResult } from '@shared/ipc'

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

vi.mock('@renderer/hooks/useCompletionCelebration', () => ({
  useCompletionCelebration: () => ({ celebrate: vi.fn(), celebrationProps: {} })
}))

import { ExportDialog } from '@renderer/components/export/ExportDialog'
import { fakeBridge } from '../renderer/fakeBridge'

// The preflight read and the generate write are a query and a mutation now, so
// the dialog needs a client. retry:false keeps a failed export from being
// retried behind the assertions.
function renderDialog(onClose = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })
  return render(
    <QueryClientProvider client={client}>
      <ExportDialog caseId="case-1" caseName="Case One" onClose={onClose} />
    </QueryClientProvider>
  )
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

describe('ExportDialog', () => {
  let preflight: ReturnType<typeof vi.fn>
  let generateReport: ReturnType<typeof vi.fn>
  let showItemInFolder: ReturnType<typeof vi.fn>
  let openPath: ReturnType<typeof vi.fn>
  let onExportProgress: ReturnType<typeof vi.fn>
  let progressCb: ((event: ExportProgressEvent) => void) | null

  beforeEach(() => {
    progressCb = null
    preflight = vi.fn().mockResolvedValue({
      captureCount: 3,
      stampedCaptureCount: 1,
      unstampedCaptureCount: 2,
      pendingCaptureCount: 1,
      noneCaptureCount: 1
    } satisfies ExportPreflight)
    generateReport = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: 'Case_One_evidence.zip'
    } satisfies ExportResult)
    showItemInFolder = vi.fn().mockResolvedValue(undefined)
    openPath = vi.fn().mockResolvedValue('')
    onExportProgress = vi.fn((cb: (event: ExportProgressEvent) => void) => {
      progressCb = cb
      return vi.fn()
    })
    fakeBridge({
      export: { preflight, generateReport },
      shell: { showItemInFolder, openPath },
      onExportProgress
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the un-stamped capture warning before export', async () => {
    renderDialog()

    expect(
      await screen.findByText(/2 captures will export without RFC 3161 trusted time/)
    ).toBeDefined()
    expect(preflight).toHaveBeenCalledWith('case-1')
  })

  it('exports a ZIP evidence package by default', async () => {
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    const [, options] = generateReport.mock.calls[0] as [string, ExportOptions]
    expect(options.format).toBe('zip')
    expect(options.outputPath).toBe('Case_One_evidence.zip')
    // The include toggles decide what lands in the evidence package, so pin all
    // four rather than only the two that name the file.
    expect(options.include).toEqual({
      captures: true,
      screenshots: true,
      auditTrail: true,
      annotations: 'burned'
    })
    expect(options.investigatorName).toBe('Investigator')
  })

  it('renders the live step and percent from export progress events', async () => {
    const gate = deferred<ExportResult>()
    generateReport.mockReturnValue(gate.promise)
    renderDialog()

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(onExportProgress).toHaveBeenCalled())

    act(() => {
      progressCb?.({ caseId: 'case-1', step: 'Verifying capture 2 of 3...', percent: 30 })
    })

    expect(await screen.findByText('Verifying capture 2 of 3...')).toBeDefined()
    expect(screen.getByText('30%')).toBeDefined()

    gate.resolve({ canceled: false, filePath: 'Case_One_evidence.zip' })
  })

  it('ignores progress events for other cases', async () => {
    const gate = deferred<ExportResult>()
    generateReport.mockReturnValue(gate.promise)
    renderDialog()

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(onExportProgress).toHaveBeenCalled())

    act(() => {
      progressCb?.({ caseId: 'other-case', step: 'Should not show', percent: 99 })
    })

    expect(screen.queryByText('Should not show')).toBeNull()
    gate.resolve({ canceled: false, filePath: 'Case_One_evidence.zip' })
  })

  it('shows the completion screen with file actions on success', async () => {
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    expect(await screen.findByText('Export complete')).toBeDefined()
    expect(screen.getByText('Case_One_evidence.zip')).toBeDefined()

    fireEvent.click(screen.getByText('Reveal in folder'))
    expect(showItemInFolder).toHaveBeenCalledWith('Case_One_evidence.zip')

    fireEvent.click(screen.getByText('Open file'))
    expect(openPath).toHaveBeenCalledWith('Case_One_evidence.zip')
  })

  it('returns to the form when the save dialog is canceled (no false success)', async () => {
    generateReport.mockResolvedValue({ canceled: true } satisfies ExportResult)
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Export')).toBeDefined())
    expect(screen.queryByText('Export complete')).toBeNull()
  })

  it('surfaces an error and offers retry', async () => {
    generateReport.mockRejectedValueOnce(new Error('disk full'))
    renderDialog()

    fireEvent.click(screen.getByText('Export'))

    expect(await screen.findByText(/disk full/)).toBeDefined()
    expect(screen.getByText('Try again')).toBeDefined()
  })
})
