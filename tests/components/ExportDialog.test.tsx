// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import type { ExportOptions, ExportPreflight } from '@shared/types'

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

vi.mock('@renderer/hooks/useTheater', () => ({
  useTheater: () => ({ stage: 'Preparing report...', progress: 0, isComplete: false })
}))

vi.mock('@renderer/hooks/useCompletionCelebration', () => ({
  useCompletionCelebration: () => ({ celebrate: vi.fn(), celebrationProps: {} })
}))

import { ExportDialog } from '@renderer/components/export/ExportDialog'

interface BirdbrainStub {
  export: {
    preflight: ReturnType<typeof vi.fn>
    generateReport: ReturnType<typeof vi.fn>
  }
}

describe('ExportDialog', () => {
  let preflight: ReturnType<typeof vi.fn>
  let generateReport: ReturnType<typeof vi.fn>

  beforeEach(() => {
    preflight = vi.fn().mockResolvedValue({
      captureCount: 3,
      stampedCaptureCount: 1,
      unstampedCaptureCount: 2,
      pendingCaptureCount: 1,
      noneCaptureCount: 1
    } satisfies ExportPreflight)
    generateReport = vi.fn().mockResolvedValue(undefined)
    ;(window as unknown as { birdbrain: BirdbrainStub }).birdbrain = {
      export: { preflight, generateReport }
    }
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the un-stamped capture warning before export', async () => {
    render(<ExportDialog caseId="case-1" caseName="Case One" onClose={vi.fn()} />)

    expect(await screen.findByText(/2 captures will export without RFC 3161 trusted time/)).toBeDefined()
    expect(preflight).toHaveBeenCalledWith('case-1')
  })

  it('exports a ZIP evidence package by default', async () => {
    render(<ExportDialog caseId="case-1" caseName="Case One" onClose={vi.fn()} />)

    fireEvent.click(screen.getByText('Export'))

    await waitFor(() => expect(generateReport).toHaveBeenCalledTimes(1))
    const [, options] = generateReport.mock.calls[0] as [string, ExportOptions]
    expect(options.format).toBe('zip')
    expect(options.outputPath).toBe('Case_One_evidence.zip')
  })
})
