// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
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

vi.mock('@renderer/hooks/useCompletionCelebration', () => ({
  useCompletionCelebration: () => ({ celebrate: vi.fn(), celebrationProps: {} })
}))

import { ExportDialog } from '@renderer/components/export/ExportDialog'

interface BirdbrainStub {
  export: {
    preflight: ReturnType<typeof vi.fn>
    generateReport: ReturnType<typeof vi.fn>
  }
  shell: {
    showItemInFolder: ReturnType<typeof vi.fn>
    openPath: ReturnType<typeof vi.fn>
  }
  onExportProgress: ReturnType<typeof vi.fn>
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

let client: QueryClient

function Wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('ExportDialog', () => {
  let preflight: ReturnType<typeof vi.fn>
  let generateReport: ReturnType<typeof vi.fn>
  let showItemInFolder: ReturnType<typeof vi.fn>
  let openPath: ReturnType<typeof vi.fn>
  let onExportProgress: ReturnType<typeof vi.fn>
  let progressCb: ((event: ExportProgressEvent) => void) | null

  beforeEach(() => {
    client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
    })
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
    ;(window as unknown as { birdbrain: BirdbrainStub }).birdbrain = {
      export: { preflight, generateReport },
      shell: { showItemInFolder, openPath },
      onExportProgress
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the un-stamped capture warning before export', async () => {
    render(<ExportDialog caseId="case-1" caseName="Case One" onClose={vi.fn()} />, {
      wrapper: Wrapper
    })

    expect(
      await screen.findByText(/2 captures will export without RFC 3161 trusted time/)
    ).toBeDefined()
    expect(preflight).toHaveBeenCalledWith('case-1')
  })

  it('exports a ZIP evidence package by default', async () => {
    render(<ExportDialog caseId="case-1" caseName="Case One" onClose={vi.fn()} />, {
      wrapper: Wrapper
    })

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    const [, options] = generateReport.mock.calls[0] as [string, ExportOptions]
    expect(options.format).toBe('zip')
    expect(options.outputPath).toBe('Case_One_evidence.zip')
  })

  it('renders the live step and percent from export progress events', async () => {
    const gate = deferred<ExportResult>()
    generateReport.mockReturnValue(gate.promise)
    render(<ExportDialog caseId="case-1" caseName="Case One" onClose={vi.fn()} />, {
      wrapper: Wrapper
    })

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
    render(<ExportDialog caseId="case-1" caseName="Case One" onClose={vi.fn()} />, {
      wrapper: Wrapper
    })

    fireEvent.click(screen.getByText('Export'))
    await waitFor(() => expect(onExportProgress).toHaveBeenCalled())

    act(() => {
      progressCb?.({ caseId: 'other-case', step: 'Should not show', percent: 99 })
    })

    expect(screen.queryByText('Should not show')).toBeNull()
    gate.resolve({ canceled: false, filePath: 'Case_One_evidence.zip' })
  })

  it('shows the completion screen with file actions on success', async () => {
    render(<ExportDialog caseId="case-1" caseName="Case One" onClose={vi.fn()} />, {
      wrapper: Wrapper
    })

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
    render(<ExportDialog caseId="case-1" caseName="Case One" onClose={vi.fn()} />, {
      wrapper: Wrapper
    })

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.getByText('Export')).toBeDefined())
    expect(screen.queryByText('Export complete')).toBeNull()
  })

  it('surfaces an error and offers retry', async () => {
    generateReport.mockRejectedValueOnce(new Error('disk full'))
    render(<ExportDialog caseId="case-1" caseName="Case One" onClose={vi.fn()} />, {
      wrapper: Wrapper
    })

    fireEvent.click(screen.getByText('Export'))

    expect(await screen.findByText(/disk full/)).toBeDefined()
    expect(screen.getByText('Try again')).toBeDefined()
  })
})
