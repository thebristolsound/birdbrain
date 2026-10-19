import { listSharedCaseIds } from '@main/services/db/caseRepo'
import { ident } from '@main/services/logSafe'
import { logger } from '@main/services/logger'
import { SharingError } from '@main/services/sharing/errors'
import type { SharingService, TransportProvider } from '@main/services/sharing/sharingService'
import type { SharingErrorCode } from '@shared/types'

// When Shared Case sessions run (#1881; docs/specs/2026-09-19-collaborative-
// cases-design.md, "Sync session"): a round at launch, a round every 60 s once
// the transport is up, and Sync now. A round pulls each Shared Case in turn
// through the sharing service's per-Case single-flight, so a round, a Sync now
// and a join's first session never run two sessions on one Case at once. This
// module reads no message and stores nothing; which members a round dials is
// the sharing service's call, from the roster.
//
// It owns the transport's lifetime without opening a second endpoint: it
// installs the sharing service's only transport provider, so whichever comes
// first of the launch round, an invite, a join or Sync now starts the one
// transport and listener, and `stop` closes it. With no Shared Case and no
// invite or join, nothing asks the provider and no connection opens.

export const SYNC_INTERVAL_MS = 60_000

// Keeps an e2e launch off the network: the provider refuses without starting
// a transport. Read only in an unpackaged build, as E2E_LOOPBACK_SWITCH is
// (localAddressPolicy.ts), so a stray variable cannot turn sharing off in an
// installed app.
export const E2E_SHARING_OFF_SWITCH = 'BIRDBRAIN_E2E_SHARING_OFF'

export function sharingSwitchedOff(value: string | undefined, allowOverride: boolean): boolean {
  return allowOverride && value === '1'
}

// Refusals that mean no transport is running, so the rest of the round would
// only ask for one again.
const OFF_CODES: ReadonlySet<SharingErrorCode> = new Set<SharingErrorCode>([
  'sharing-unavailable',
  'relay-unreachable',
  'relay-url-invalid'
])

export interface SyncServiceDeps {
  sharing: Pick<SharingService, 'setTransportProvider' | 'syncNow' | 'close'>
  // Starts the installation's transport: Iroh in the app, a MemoryTransport
  // in tests.
  transportFactory: TransportProvider
  intervalMs?: number
  sharedCaseIds?: () => Iterable<string>
  switchedOff?: boolean
}

export interface SyncService {
  // Starts the launch round without waiting for it. Never throws.
  start(): void
  // Clears the timer and closes the transport; nothing starts after it.
  stop(): Promise<void>
  // The round in flight, or a settled promise.
  idle(): Promise<void>
}

export function createSyncService(deps: SyncServiceDeps): SyncService {
  const {
    sharing,
    transportFactory,
    intervalMs = SYNC_INTERVAL_MS,
    sharedCaseIds = listSharedCaseIds,
    switchedOff = false
  } = deps
  let timer: ReturnType<typeof setInterval> | undefined
  let inFlight: Promise<void> | null = null
  let started = false
  let stopped = false

  // The timer exists only once a transport is up: a transport that cannot
  // start leaves the service off, and a later command that starts one turns
  // automatic sync back on.
  function armTimer(): void {
    if (timer !== undefined || stopped) return
    timer = setInterval(() => void round(), intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  sharing.setTransportProvider(async () => {
    if (stopped || switchedOff) return null
    const transport = await transportFactory()
    if (transport !== null) armTimer()
    return transport
  })

  async function run(): Promise<void> {
    let ids: string[]
    try {
      ids = [...sharedCaseIds()]
    } catch (err) {
      logger.warn('sharing', 'sharing.case_sync_failed', undefined, err)
      return
    }
    for (const caseId of ids) {
      if (stopped) return
      try {
        await sharing.syncNow(caseId)
      } catch (err) {
        if (err instanceof SharingError && OFF_CODES.has(err.code)) {
          logger.info('sharing', 'sharing.sync_off', undefined, err)
          return
        }
        logger.warn('sharing', 'sharing.case_sync_failed', { caseId: ident(caseId) }, err)
      }
    }
  }

  // A tick that finds the previous round still running starts nothing.
  function round(): void {
    if (stopped || inFlight !== null) return
    inFlight = run().finally(() => {
      inFlight = null
    })
  }

  return {
    start() {
      if (stopped || started) return
      started = true
      round()
    },
    stop() {
      stopped = true
      if (timer !== undefined) clearInterval(timer)
      timer = undefined
      return sharing.close()
    },
    idle() {
      return inFlight ?? Promise.resolve()
    }
  }
}
