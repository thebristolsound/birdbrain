import { listSharedCaseIds } from '@main/services/db/caseRepo'
import { ident } from '@main/services/logSafe'
import { logger } from '@main/services/logger'
import { SharingError } from '@main/services/sharing/errors'
import type { SharingService, TransportProvider } from '@main/services/sharing/sharingService'
import type { Transport } from '@main/services/sharing/transport'

// When Shared Case sessions run (#1881; docs/specs/2026-09-19-collaborative-
// cases-design.md, "Sync session"): a round at launch, a round every 60 s once
// the transport has started or a start has failed, and Sync now. A round
// pulls each Shared Case in turn through the sharing service's per-Case
// single-flight, so a round, a Sync now and a join's first session never run
// two sessions on one Case at once. This module reads no message and stores
// nothing; which members a round dials is the sharing service's call, from
// the roster. No ticket is built from a roster node id, which names no relay:
// a member is dialed at the last ticket stored for it, the welcome's or one
// it sent in a later hello (#1809), and one with none is `no-address`.
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
  // The round in flight, or a settled promise. After `stop`, it settles once
  // the closed transport has ended the round, so the database may close.
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
  let startFailure: unknown = undefined

  // A transport that cannot load (the factory returns null) leaves the
  // service off until a later command starts one. A start that throws, such
  // as a relay unreachable while the network is still coming up, arms the
  // timer anyway, so the next tick tries again.
  function armTimer(): void {
    if (timer !== undefined || stopped) return
    timer = setInterval(() => void round(), intervalMs)
    if (typeof timer.unref === 'function') timer.unref()
  }

  sharing.setTransportProvider(async () => {
    if (stopped || switchedOff) return null
    let transport: Transport | null
    try {
      transport = await transportFactory()
    } catch (err) {
      startFailure = err
      armTimer()
      throw err
    }
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
        // A session the closed transport ended at quit is no failure.
        if (stopped) return
        // The rest of the round would only ask for a transport again.
        if (err instanceof SharingError && err.code === 'sharing-unavailable') {
          logger.info('sharing', 'sharing.sync_off', undefined, err)
          return
        }
        if (err === startFailure) {
          logger.info('sharing', 'sharing.sync_start_failed', undefined, err)
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
