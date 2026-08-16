// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const navigateSpy = vi.fn()

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy
}))

const notifyError = vi.hoisted(() => vi.fn())

vi.mock('@renderer/lib/notify', () => ({
  notify: { error: notifyError, warn: vi.fn(), success: vi.fn(), info: vi.fn() }
}))

// The markdown renderer and the motion wrappers carry none of the behaviour
// under test, and both bring their own async machinery into jsdom.
//
// The one exception is the `a` override: routing AI-authored links through the
// shell instead of in-app navigation IS behaviour under test, so a markdown
// link is rendered through components.a rather than flattened to text.
vi.mock('react-markdown', async () => {
  const React = await import('react')
  return {
    default: ({
      children,
      components
    }: {
      children: string
      components?: { a?: (props: { href?: string; children: ReactNode }) => ReactNode }
    }) => {
      const anchor = components?.a
      if (!anchor) return children
      // Split on every link rather than returning the first one: a mock that
      // kept only the link would discard the prose around it, and a later test
      // asserting on both would fail on the missing prose with nothing
      // pointing back at the mock as the cause.
      const parts: ReactNode[] = []
      const pattern = /\[([^\]]+)\]\(([^)]+)\)/g
      let consumed = 0
      for (let m = pattern.exec(children); m; m = pattern.exec(children)) {
        if (m.index > consumed) parts.push(children.slice(consumed, m.index))
        parts.push(
          React.createElement(
            React.Fragment,
            { key: m.index },
            anchor({ href: m[2], children: m[1] })
          )
        )
        consumed = m.index + m[0].length
      }
      if (parts.length === 0) return children
      if (consumed < children.length) parts.push(children.slice(consumed))
      return parts
    }
  }
})

// Strips the animation-only props (they are not valid DOM attributes) and
// forwards everything else — Button renders through motion.button, so dropping
// props here would silently drop its onClick.
vi.mock('motion/react', async () => {
  const React = await import('react')
  // Memoised per tag: a fresh forwardRef on every property access is a new
  // component type each render, so React unmounts and remounts the whole
  // subtree. That detaches any node a test is already holding, and the click
  // then lands on an element no longer in the tree.
  const cache = new Map<string, unknown>()
  const motion = new Proxy(
    {},
    {
      get: (_, tag: string) => {
        const cached = cache.get(tag)
        if (cached) return cached
        const component = React.forwardRef<
          HTMLElement,
          Record<string, unknown> & { children?: ReactNode }
        >(({ children, ...props }, ref) => {
          const { initial, animate, exit, transition, whileTap, whileHover, layout, ...domProps } =
            props
          void initial
          void animate
          void exit
          void transition
          void whileTap
          void whileHover
          void layout
          // forwardRef wraps P in PropsWithoutRef, which collapses an index-signature
          // props type through Omit and widens children to unknown. Narrow it back.
          return React.createElement(tag, { ...domProps, ref }, children as ReactNode)
        })
        cache.set(tag, component)
        return component
      }
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
  vi.useRealTimers()
  vi.restoreAllMocks()
  navigateSpy.mockReset()
  notifyError.mockReset()
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
    const saveAnalysis = vi.fn(async (analysis: typeof saved) => {
      void analysis
    })
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

  it('analyses with the model the operator picked over the stored default', async () => {
    const analyze = vi.fn(async () => ({
      content: 'fresh findings',
      tokenUsage: { prompt: 4, completion: 5, total: 9 }
    }))
    fakeBridge({
      settings: {
        get: vi.fn(async () => settings),
        listModels: vi.fn(async () => [
          { id: 'model-a', name: 'Model A' },
          { id: 'model-b', name: 'Model B' }
        ])
      },
      ai: { getAnalysis: vi.fn(async () => null), analyze }
    })

    renderTab()

    // The model is recorded on the analysis row, so the pick has to reach the
    // call rather than the stored default silently winning.
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'model-b' } })
    fireEvent.click(screen.getByText('Analyze'))

    await waitFor(() =>
      expect(analyze).toHaveBeenCalledWith({
        captureId: 'c1',
        caseId: 'case-1',
        model: 'model-b'
      })
    )
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

  it('saves the model the run used, not the one left in the picker', async () => {
    const analyze = vi.fn(async () => ({
      content: 'fresh findings',
      tokenUsage: { prompt: 4, completion: 5, total: 9 }
    }))
    const saveAnalysis = vi.fn(async (analysis: typeof saved) => {
      void analysis
    })
    fakeBridge({
      settings: {
        get: vi.fn(async () => settings),
        listModels: vi.fn(async () => [
          { id: 'model-a', name: 'Model A' },
          { id: 'model-b', name: 'Model B' }
        ])
      },
      ai: { getAnalysis: vi.fn(async () => null), analyze, saveAnalysis }
    })

    renderTab()

    fireEvent.click(await screen.findByText('Analyze'))
    expect(await screen.findByText('fresh findings')).toBeDefined()

    // Moving the picker after the run must not rewrite what produced the
    // findings — the row would then credit a model that never saw the capture.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'model-b' } })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(saveAnalysis).toHaveBeenCalledOnce())
    expect(saveAnalysis.mock.calls[0][0]).toMatchObject({
      content: 'fresh findings',
      model: 'model-a'
    })
  })

  it('treats a re-run under a different model as unsaved even with identical content', async () => {
    let stored: typeof saved = saved
    const getAnalysis = vi.fn(async () => stored)
    // Same text back from a different model: plausible for a short answer, and
    // the only signal that anything changed is the model on the row.
    const analyze = vi.fn(async () => ({
      content: saved.content,
      tokenUsage: saved.tokenUsage
    }))
    const saveAnalysis = vi.fn(async (analysis: typeof saved) => {
      stored = analysis
    })
    fakeBridge({
      settings: {
        get: vi.fn(async () => settings),
        listModels: vi.fn(async () => [
          { id: 'model-a', name: 'Model A' },
          { id: 'model-b', name: 'Model B' }
        ])
      },
      ai: { getAnalysis, analyze, saveAnalysis }
    })

    renderTab()

    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'model-b' } })
    fireEvent.click(screen.getByText('Re-analyze'))

    expect(await screen.findByText('⚡ Unsaved')).toBeDefined()

    fireEvent.click(screen.getByText('Save Changes'))

    await waitFor(() => expect(saveAnalysis).toHaveBeenCalledOnce())
    expect(saveAnalysis.mock.calls[0][0]).toMatchObject({
      content: saved.content,
      model: 'model-b'
    })
  })

  it("shows the stored row's timestamp once the run is saved", async () => {
    // Analysis at 10:00, save at 10:20. The run's own stamp is not persisted,
    // so a footer still reading it would show 10:00 beside "✓ Saved" while the
    // row — and every later reader of it — records 10:20.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-08-06T10:00:00.000Z') })
    let stored: typeof saved | null = null
    const getAnalysis = vi.fn(async () => stored)
    const analyze = vi.fn(async () => ({
      content: 'fresh findings',
      tokenUsage: { prompt: 4, completion: 5, total: 9 }
    }))
    const saveAnalysis = vi.fn(async (analysis: typeof saved) => {
      stored = analysis
    })
    fakeBridge({
      settings: { get: vi.fn(async () => settings), listModels: vi.fn(async () => []) },
      ai: { getAnalysis, analyze, saveAnalysis }
    })

    renderTab()

    fireEvent.click(await screen.findByText('Analyze'))
    expect(await screen.findByText('fresh findings')).toBeDefined()
    expect(screen.getByText(new Date('2026-08-06T10:00:00.000Z').toLocaleString())).toBeDefined()

    vi.setSystemTime(new Date('2026-08-06T10:20:00.000Z'))
    fireEvent.click(screen.getByText('Save'))

    expect(await screen.findByText('✓ Saved')).toBeDefined()
    expect(screen.getByText(new Date('2026-08-06T10:20:00.000Z').toLocaleString())).toBeDefined()
  })

  it('says so when the clipboard copy is refused', async () => {
    fakeBridge({
      settings: { get: vi.fn(async () => settings), listModels: vi.fn(async () => []) },
      ai: { getAnalysis: vi.fn(async () => saved) }
    })
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn(async () => Promise.reject(new Error('denied'))) },
      configurable: true
    })

    renderTab()

    fireEvent.click(await screen.findByText('Copy'))

    // A rejected write with an unchanged button reads as "nothing happened".
    expect(await screen.findByText('Copy failed')).toBeDefined()
  })

  it('confirms the copy when the clipboard accepts it', async () => {
    const writeText = vi.fn(async () => undefined)
    fakeBridge({
      settings: { get: vi.fn(async () => settings), listModels: vi.fn(async () => []) },
      ai: { getAnalysis: vi.fn(async () => saved) }
    })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    renderTab()

    fireEvent.click(await screen.findByText('Copy'))

    expect(await screen.findByText('Copied!')).toBeDefined()
    expect(writeText).toHaveBeenCalledWith(saved.content)
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

  it('reports a failed shell launch when a link in the analysis cannot be opened', async () => {
    // Held so the assertion can be on identity: the handler must pass the
    // original rejection through as `cause`, not a rewrapped stand-in.
    const cause = new Error('EACCES')
    const openExternal = vi.fn(async () => {
      throw cause
    })
    fakeBridge({
      settings: { get: vi.fn(async () => settings), listModels: vi.fn(async () => []) },
      ai: {
        getAnalysis: vi.fn(async () => ({
          ...saved,
          content: 'see [the source](https://example.com/leak) before filing'
        }))
      },
      captures: { openExternal }
    })

    renderTab()

    const link = await screen.findByText('the source')
    // Prose either side of the link survives the markdown mock, so a later
    // test can assert on both without the mock quietly eating one of them.
    expect(link.parentElement?.textContent).toBe('see the source before filing')

    fireEvent.click(link)

    await waitFor(() => expect(notifyError).toHaveBeenCalledOnce())
    const [message, opts] = notifyError.mock.calls[0]
    // Exact match, not a substring: the URL is the operator's evidence trail,
    // and a fixed literal with nothing interpolated into it is what keeps it
    // out of the durable log. A message that grew the URL would fail here.
    expect(message).toBe("Couldn't open the link in your browser")
    expect(opts.cause).toBe(cause)
  })
})
