// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const navigateSpy = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy
}))

// The markdown renderer and the motion wrappers carry none of the behaviour
// under test, and both bring their own async machinery into jsdom.
vi.mock('react-markdown', () => ({
  default: ({ children }: { children: string }) => children
}))

// Strips the animation-only props (they are not valid DOM attributes) and
// forwards everything else — Button renders through motion.button, so dropping
// props here would silently drop its onClick.
vi.mock('motion/react', async () => {
  const React = await import('react')
  const motion = new Proxy(
    {},
    {
      get: (_, tag: string) =>
        React.forwardRef<HTMLElement, Record<string, unknown> & { children?: ReactNode }>(
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
  return { motion, AnimatePresence: ({ children }: { children: ReactNode }) => children }
})

import { AnalysisTab } from '@renderer/components/captures/AnalysisTab'
import { fakeBridge } from '../renderer/fakeBridge'

const settings = { openRouterApiKey: 'sk-test', defaultModel: 'model-a' }

const saved = {
  id: 'a1',
  captureId: 'c1',
  caseId: 'case-1',
  content: 'previously saved findings',
  model: 'model-a',
  tokenUsage: { prompt: 1, completion: 2, total: 3 },
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z'
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(
    <AnalysisTab captureId="c1" caseId="case-1" captureTitle="Example" onOpenNote={vi.fn()} />,
    { wrapper: Wrapper }
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  navigateSpy.mockReset()
})

describe('AnalysisTab', () => {
  it('sends the operator to Settings when no API key is configured', async () => {
    fakeBridge({
      settings: { get: vi.fn(async () => ({ openRouterApiKey: '', defaultModel: '' })) },
      ai: { getAnalysis: vi.fn(async () => null) }
    })

    renderTab()

    fireEvent.click(await screen.findByText('Open Settings'))
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/settings' })
  })

  it('renders the saved analysis for the capture', async () => {
    fakeBridge({
      settings: { get: vi.fn(async () => settings), listModels: vi.fn(async () => []) },
      ai: { getAnalysis: vi.fn(async () => saved) }
    })

    renderTab()

    expect(await screen.findByText('previously saved findings')).toBeDefined()
    expect(screen.getByText('✓ Saved')).toBeDefined()
  })

  it('analyses on demand and saves the result back under the same key', async () => {
    const getAnalysis = vi.fn(async () => null)
    const analyze = vi.fn(async () => ({
      content: 'fresh findings',
      tokenUsage: { prompt: 4, completion: 5, total: 9 }
    }))
    const saveAnalysis = vi.fn(async () => undefined)
    fakeBridge({
      settings: { get: vi.fn(async () => settings), listModels: vi.fn(async () => []) },
      ai: { getAnalysis, analyze, saveAnalysis }
    })

    renderTab()

    fireEvent.click(await screen.findByText('Analyze'))

    expect(await screen.findByText('fresh findings')).toBeDefined()
    expect(analyze).toHaveBeenCalledWith({
      captureId: 'c1',
      caseId: 'case-1',
      model: 'model-a'
    })
    expect(screen.getByText('⚡ Unsaved')).toBeDefined()

    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(saveAnalysis).toHaveBeenCalledOnce())
    // uuid and createdAt are minted at save time; everything else is the
    // analysis on screen.
    expect(saveAnalysis.mock.calls[0][0]).toMatchObject({
      captureId: 'c1',
      caseId: 'case-1',
      content: 'fresh findings',
      model: 'model-a'
    })
    // The post-save invalidation must hit the same key the read uses, or the
    // tab keeps showing "Unsaved" over a row that is on disk.
    await waitFor(() => expect(getAnalysis).toHaveBeenCalledTimes(2))
  })

  it('re-analyses over a stored row without re-minting its identity', async () => {
    // A stand-in for the upsert in main: the read reflects the write, so the
    // post-save refetch confirms the row rather than contradicting it.
    let stored: typeof saved = saved
    const getAnalysis = vi.fn(async () => stored)
    const analyze = vi.fn(async () => ({
      content: 'revised findings',
      tokenUsage: { prompt: 6, completion: 7, total: 13 }
    }))
    const saveAnalysis = vi.fn(async (analysis: typeof saved) => {
      stored = analysis
    })
    fakeBridge({
      settings: { get: vi.fn(async () => settings), listModels: vi.fn(async () => []) },
      ai: { getAnalysis, analyze, saveAnalysis }
    })

    renderTab()

    fireEvent.click(await screen.findByText('Re-analyze'))

    expect(await screen.findByText('revised findings')).toBeDefined()
    expect(screen.getByText('⚡ Unsaved')).toBeDefined()

    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => expect(saveAnalysis).toHaveBeenCalledOnce())
    // The row is upserted by captureId: a second identity or a rewritten
    // createdAt would misdate when this capture was first analysed.
    expect(saveAnalysis.mock.calls[0][0]).toMatchObject({
      id: saved.id,
      createdAt: saved.createdAt,
      content: 'revised findings'
    })
    // The saved row is written through to the cache, so the tab settles on
    // "saved" from the write rather than from a locally cleared flag.
    expect(await screen.findByText('✓ Saved')).toBeDefined()
  })

  it('offers a retry when the analysis call fails', async () => {
    fakeBridge({
      settings: { get: vi.fn(async () => settings), listModels: vi.fn(async () => []) },
      ai: {
        getAnalysis: vi.fn(async () => null),
        analyze: vi.fn(async () => Promise.reject(new Error('model unavailable')))
      }
    })

    renderTab()

    fireEvent.click(await screen.findByText('Analyze'))

    expect(await screen.findByText('model unavailable')).toBeDefined()
    expect(screen.getByText('Retry')).toBeDefined()
  })
})
