// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DiagnosticsSnapshot } from '@shared/types'

// hoisted: the component is imported statically below, so the sonner mock has
// to be in place before notify's own top-level import of it runs.
const toastFns = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  info: vi.fn()
}))
vi.mock('sonner', () => ({ toast: toastFns }))

// Strips the animation-only props (they are not valid DOM attributes) and
// forwards the rest — Button renders through motion.button, so dropping props
// here would silently drop its onClick.
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

import { DiagnosticsPanel } from '@renderer/components/settings/DiagnosticsPanel'
import { fakeBridge } from '../renderer/fakeBridge'

const STORAGE_ROOT = '/home/tester/Birdbrain'

const snapshot: DiagnosticsSnapshot = {
  generatedAt: '2026-08-04T10:00:00.000Z',
  app: {
    version: '1.2.3',
    electron: '38.0.0',
    chrome: '140.0.0',
    node: '20.20.2',
    platform: 'linux',
    arch: 'x64',
    packaged: false,
    installFormat: 'dev'
  },
  uptimeSeconds: 42,
  processes: [],
  eventLoop: { currentLagMs: 3, maxLagLastMinuteMs: 12, stalls: [] },
  storage: {
    storageRoot: STORAGE_ROOT,
    dbPath: `${STORAGE_ROOT}/birdbrain.db`,
    dbSizeBytes: 2048,
    walSizeBytes: 0
  },
  data: {
    schemaVersion: 42,
    latestSchemaVersion: 42,
    cases: 1,
    captures: 2,
    notes: 0,
    selectors: 0,
    extractedData: 0
  },
  slowOps: []
}

let log: ReturnType<typeof vi.fn>
let openPath: ReturnType<typeof vi.fn>

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return render(<DiagnosticsPanel />, { wrapper: Wrapper })
}

async function clickStorageRoot() {
  fireEvent.click(await screen.findByText(STORAGE_ROOT))
}

describe('DiagnosticsPanel storage folder action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    log = vi.fn().mockResolvedValue('cid-1')
    openPath = vi.fn().mockResolvedValue('')
    fakeBridge({
      diagnostics: { get: vi.fn().mockResolvedValue(snapshot), log },
      shell: { openPath }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('opens the storage folder without complaining when the shell accepts it', async () => {
    renderPanel()
    await clickStorageRoot()

    await waitFor(() => expect(openPath).toHaveBeenCalledWith(STORAGE_ROOT))
    expect(toastFns.error).not.toHaveBeenCalled()
  })

  it('surfaces a rejected openPath and keeps the storage path out of the durable log', async () => {
    // The rejection embeds the storage path the way a real fs/shell error does.
    // Without it the assertion below passes even if notify serialised the whole
    // toast message, because a path-free message contains no path to find.
    openPath.mockRejectedValue(new Error(`EACCES: permission denied, scandir '${STORAGE_ROOT}'`))
    renderPanel()
    await clickStorageRoot()

    await waitFor(() => expect(toastFns.error).toHaveBeenCalled())
    expect(toastFns.error.mock.calls[0][0]).toContain('EACCES: permission denied')
    // The path is deliberately NOT withheld from the toast: the toast is
    // ephemeral, the panel prints storageRoot verbatim as the button that was
    // just clicked, and #350's third criterion scopes the ban to durable
    // messages. Asserted so a future "sanitise this" edit turns red here.
    expect(toastFns.error.mock.calls[0][0]).toContain(STORAGE_ROOT)

    // notify writes the code and the cause's constructor name, never prose —
    // the path the operator sees in the toast must not reach the log file.
    await waitFor(() => expect(log).toHaveBeenCalled())
    const payload = JSON.stringify(log.mock.calls[0][0])
    expect(payload).not.toContain(STORAGE_ROOT)
    expect(payload).not.toContain('tester')
    expect(payload).toContain('"error":"Error"')
  })

  it('surfaces the failure openPath reports by resolving to a non-empty string', async () => {
    // shell.openPath refuses by resolving, not rejecting — a catch alone leaves
    // this path silent. The reason carries the path for the same reason as above.
    openPath.mockResolvedValue(`Failed to open path ${STORAGE_ROOT}`)
    renderPanel()
    await clickStorageRoot()

    await waitFor(() => expect(toastFns.error).toHaveBeenCalled())
    expect(toastFns.error.mock.calls[0][0]).toContain('Failed to open path')
    expect(toastFns.error.mock.calls[0][0]).toContain(STORAGE_ROOT)

    await waitFor(() => expect(log).toHaveBeenCalled())
    const payload = JSON.stringify(log.mock.calls[0][0])
    expect(payload).not.toContain(STORAGE_ROOT)
    expect(payload).not.toContain('tester')
  })
})
