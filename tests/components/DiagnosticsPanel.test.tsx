// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DiagnosticsSnapshot, UnreconciledDeletionReport } from '@shared/types'

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
            // forwardRef wraps P in PropsWithoutRef, which collapses an index-signature
            // props type through Omit and widens children to unknown. Narrow it back.
            return React.createElement(tag, { ...domProps, ref }, children as ReactNode)
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
  slowOps: [],
  keyProtection: { signingKey: 'protected', openRouterKey: 'not-set' }
}

const cleanReport: UnreconciledDeletionReport = {
  generatedAt: '2026-08-04T10:00:00.000Z',
  available: true,
  casesScanned: 3,
  findings: [],
  unscanned: []
}

let log: ReturnType<typeof vi.fn>
let openPath: ReturnType<typeof vi.fn>
let openStorageRoot: ReturnType<typeof vi.fn>
let unreconciledDeletions: ReturnType<typeof vi.fn>

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
    openPath = vi.fn().mockResolvedValue(undefined)
    openStorageRoot = vi.fn().mockResolvedValue(undefined)
    unreconciledDeletions = vi.fn().mockResolvedValue(cleanReport)
    fakeBridge({
      diagnostics: {
        get: vi.fn().mockResolvedValue(snapshot),
        log,
        openStorageRoot,
        unreconciledDeletions
      },
      shell: { openPath }
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows the signing key as protected from the snapshot', async () => {
    renderPanel()
    expect(await screen.findByText('Protected')).toBeDefined()
  })

  it('flags an unprotected signing key and explains why', async () => {
    fakeBridge({
      diagnostics: {
        get: vi.fn().mockResolvedValue({
          ...snapshot,
          keyProtection: { signingKey: 'plaintext', openRouterKey: 'not-set' }
        }),
        log,
        openStorageRoot,
        unreconciledDeletions
      },
      shell: { openPath }
    })
    renderPanel()
    expect(await screen.findByText('Unprotected')).toBeDefined()
    expect(await screen.findByText(/was written to disk unprotected/)).toBeDefined()
  })

  // #363: the root is opened on its own main-derived channel. The generic
  // shell:openPath is allowlist-gated and never held the root, so routing the
  // click there is exactly the always-fails behaviour this pins against.
  it('opens the storage folder via the diagnostics channel, never shell:openPath', async () => {
    renderPanel()
    await clickStorageRoot()

    await waitFor(() => expect(openStorageRoot).toHaveBeenCalledOnce())
    expect(openStorageRoot).toHaveBeenCalledWith()
    expect(openPath).not.toHaveBeenCalled()
    expect(toastFns.error).not.toHaveBeenCalled()
  })

  it('surfaces a rejected open and keeps the storage path out of the durable log', async () => {
    // The rejection embeds the storage path the way a real fs/shell error does.
    // Without it the assertion below passes even if notify serialised the whole
    // toast message, because a path-free message contains no path to find.
    openStorageRoot.mockRejectedValue(
      new Error(`EACCES: permission denied, scandir '${STORAGE_ROOT}'`)
    )
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
})

// #622. The panel is the only surface for the crash artefact in wave 1, so its
// copy carries the whole ADR-0004 claim: what the scan established, and what it
// deliberately did not look at.
describe('DiagnosticsPanel unreconciled deletions', () => {
  const finding = {
    caseId: 'case-1',
    caseName: 'Operation Kingfisher',
    captureId: 'cap-abc-123',
    manifestIndex: 7,
    entryTimestamp: '2026-08-03T09:15:00.000Z',
    operatorName: 'A. Analyst'
  }

  function mount(report: UnreconciledDeletionReport) {
    fakeBridge({
      diagnostics: {
        get: vi.fn().mockResolvedValue(snapshot),
        log: vi.fn().mockResolvedValue('cid-1'),
        openStorageRoot: vi.fn().mockResolvedValue(undefined),
        unreconciledDeletions: vi.fn().mockResolvedValue(report)
      },
      shell: { openPath: vi.fn() }
    })
    return renderPanel()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  // Before the first result lands the section must not read as a clean scan.
  it('says it is still checking while the scan is in flight', async () => {
    fakeBridge({
      diagnostics: {
        get: vi.fn().mockResolvedValue(snapshot),
        log: vi.fn().mockResolvedValue('cid-1'),
        openStorageRoot: vi.fn().mockResolvedValue(undefined),
        unreconciledDeletions: vi.fn(() => new Promise(() => {}))
      },
      shell: { openPath: vi.fn() }
    })
    renderPanel()

    expect(await screen.findByText(/Checking case manifests against the database/)).toBeDefined()
    expect(screen.queryByText(/None found/)).toBeNull()
  })

  // The scan is off the 2s poll, so Refresh is the only way to re-run it.
  it('re-runs the scan alongside the snapshot when Refresh is clicked', async () => {
    const scan = vi.fn().mockResolvedValue(cleanReport)
    const get = vi.fn().mockResolvedValue(snapshot)
    fakeBridge({
      diagnostics: {
        get,
        log: vi.fn().mockResolvedValue('cid-1'),
        openStorageRoot: vi.fn().mockResolvedValue(undefined),
        unreconciledDeletions: scan
      },
      shell: { openPath: vi.fn() }
    })
    renderPanel()
    await screen.findByText(/None found/)
    expect(scan).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByText('Refresh'))

    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2))
    expect(get.mock.calls.length).toBeGreaterThan(1)
  })

  it('states exactly what is known and the recovery action for a finding', async () => {
    mount({ ...cleanReport, casesScanned: 1, findings: [finding] })

    expect(await screen.findByText('cap-abc-123')).toBeDefined()
    expect(screen.getByText('#7')).toBeDefined()
    expect(screen.getByText('Operation Kingfisher')).toBeDefined()
    expect(screen.getByText(/Recorded deleted .* by A\. Analyst/)).toBeDefined()

    // The claim: chain verified, row present. The non-claim: on-disk files.
    expect(screen.getByText(/the case manifest chain verifies/)).toBeDefined()
    expect(screen.getByText(/whose row is still in the database/)).toBeDefined()
    expect(screen.getByText(/whether the capture.s files are still on disk/)).toBeDefined()
    expect(screen.getByText(/this check never reads them/)).toBeDefined()

    // The recovery action, and why no automatic repair exists.
    expect(screen.getByText(/delete the capture again from its case/)).toBeDefined()
    expect(screen.getByText(/appends a fresh signed deletion entry/)).toBeDefined()
    expect(screen.getByText(/holds the claim rather than the data/)).toBeDefined()
  })

  it('shows the #580 reason on an entry that recorded one', async () => {
    mount({
      ...cleanReport,
      casesScanned: 1,
      findings: [{ ...finding, reason: 'pipeline self-test cleanup' }]
    })

    expect(await screen.findByText(/pipeline self-test cleanup/)).toBeDefined()
  })

  it('reports a clean scan as none found, naming how many cases were verified', async () => {
    mount(cleanReport)

    expect(await screen.findByText(/None found across 3 verified cases/)).toBeDefined()
    expect(screen.queryByText(/delete the capture again/)).toBeNull()
  })

  // An empty findings list over a scan that never ran would read as "clean".
  it('says the scan did not run rather than none found when unavailable', async () => {
    mount({ ...cleanReport, available: false, casesScanned: 0 })

    expect(await screen.findByText(/Not run/)).toBeDefined()
    expect(screen.queryByText(/None found/)).toBeNull()
  })

  // The finding asserts a valid chain; over a chain that does not verify the
  // panel must decline to assert anything at all about that case.
  it('names a case it could not scan and disclaims any finding about it', async () => {
    mount({
      ...cleanReport,
      casesScanned: 0,
      unscanned: [{ caseId: 'case-2', caseName: 'Broken Chain', reason: 'Entry hash mismatch' }]
    })

    expect(await screen.findByText('Not scanned')).toBeDefined()
    expect(screen.getByText('Broken Chain')).toBeDefined()
    expect(screen.getByText('Entry hash mismatch')).toBeDefined()
    expect(screen.getByText(/Nothing is claimed about deletions in that case/)).toBeDefined()
    // The clean bill has to be absent, the way it is for available: false. It
    // was not: the sentence keys only on findings.length, so the panel asserted
    // "every capture the manifests record as deleted is gone" across zero
    // scanned cases while naming a case it could not read.
    expect(screen.queryByText(/is gone from the database/)).toBeNull()
  })

  // A scan that covered something but not everything. The count is true and
  // worth showing; the claim about it is not, because it would extend to cases
  // the scan never read.
  it('withholds the clean bill when the scan skipped a case', async () => {
    mount({
      ...cleanReport,
      casesScanned: 2,
      unscanned: [{ caseId: 'case-9', caseName: 'Missing Manifest', reason: 'manifest is missing' }]
    })

    expect(await screen.findByText(/None found across 2 verified cases/)).toBeDefined()
    expect(screen.getByText(/This says nothing about the cases listed below/)).toBeDefined()
    expect(screen.queryByText(/is gone from the database/)).toBeNull()
  })

  // Case names, capture ids and operator names are investigation data. The
  // clipboard is one keystroke from an issue tracker.
  it('keeps findings out of the Copy report payload', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
    mount({ ...cleanReport, casesScanned: 1, findings: [finding] })

    fireEvent.click(await screen.findByText('Copy report'))

    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const copied = writeText.mock.calls[0][0] as string
    expect(copied).not.toContain('cap-abc-123')
    expect(copied).not.toContain('Operation Kingfisher')
    expect(copied).not.toContain('A. Analyst')
  })
})
