import { app, ipcMain } from 'electron'
import type { Session } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ElectronBlocker } from '@ghostery/adblocker-electron'
import { egressFetch } from '@main/services/egress'
import { logger } from '@main/services/logger'

// Consent/cookie-notice lists ONLY — deliberately NOT the ad/tracker lists.
// Recaptures are evidence: stripping ads or trackers would alter what the page
// served, but a consent overlay only obscures it (and scroll-locks the page,
// starving the lazy-load scroll phase). Both lists are community-maintained,
// uBlock-Origin-compatible rulesets covering the major CMPs.
const CONSENT_FILTER_LISTS = [
  // EasyList Cookie List (Fanboy's Cookiemonster)
  'https://secure.fanboy.co.nz/fanboy-cookiemonster.txt',
  // uBlock Origin annoyances-cookies (includes click-through scriptlets)
  'https://ublockorigin.github.io/uAssets/filters/annoyances-cookies.txt'
]

let blockerPromise: Promise<ElectronBlocker | null> | undefined
let blockerKey: string | undefined

// Lazily builds (and disk-caches) the consent filter engine. Lazy so the app
// never fetches filter lists at startup — only when a background recapture
// actually runs. Returns null when the engine can't be built (e.g. offline and
// no cache yet); callers proceed without suppression rather than failing the
// capture. A failed build is retried on the next call.
//
// BIRDBRAIN_CONSENT_LISTS (comma-separated URLs) is the E2E seam: tests point
// it at a locally served fixture list, and the disk cache is skipped so runs
// are deterministic and offline. The memo is keyed on the resolved list source
// so changing (or clearing) the override rebuilds rather than leaking a stale
// fixture engine into a later run.
export function getConsentBlocker(): Promise<ElectronBlocker | null> {
  const override = process.env.BIRDBRAIN_CONSENT_LISTS
  const key = override ?? ''
  if (blockerPromise && blockerKey === key) return blockerPromise

  const lists = override ? override.split(',') : CONSENT_FILTER_LISTS
  const caching = override
    ? undefined
    : {
        path: join(app.getPath('userData'), 'consent-filters-engine.bin'),
        read: fs.readFile,
        write: fs.writeFile
      }
  blockerKey = key
  // The list download follows the Egress (ADR-0032). Through a stopped proxy it
  // fails, and the render proceeds without Consent Suppression, as it does offline.
  blockerPromise = ElectronBlocker.fromLists(egressFetch, lists, undefined, caching).catch(
    (err): null => {
      logger.error('consentBlocker', 'consentBlocker.filter_engine_failed', undefined, err)
      // Only clear if this is still the in-flight build for this key, so a
      // newer getConsentBlocker() call's promise isn't wiped by an older
      // rejection.
      if (blockerKey === key) {
        blockerPromise = undefined
        blockerKey = undefined
      }
      return null
    }
  )
  return blockerPromise
}

// The pinned library enables blocking per session, but `BlockingContext.enable` registers its
// cosmetic filter bridge on the global `ipcMain`, which takes one handler per channel, and
// `disable` removes it. So a second session's enable throws, and the first render to end would
// take the bridge from the others. The handlers forward to the engine and answer the frame that
// asked, so one registration serves every session of one engine. These two functions own it.
const COSMETIC_CHANNELS = [
  '@ghostery/adblocker/inject-cosmetic-filters',
  '@ghostery/adblocker/is-mutation-observer-enabled'
] as const

const enabledSessions = new Map<Session, ElectronBlocker>()

function liftBridge(): void {
  for (const channel of COSMETIC_CHANNELS) ipcMain.removeHandler(channel)
}

// Leaves the channels as the sessions still enabled need them: registered again, as the library
// does, for their engine, or clear, so that the next enable can register them.
function restoreBridge(): void {
  liftBridge()
  const [engine] = enabledSessions.values()
  if (!engine?.config.loadCosmeticFilters) return
  const [inject, mutationObserver] = COSMETIC_CHANNELS
  ipcMain.handle(inject, (...args: Parameters<ElectronBlocker['onInjectCosmeticFilters']>) =>
    engine.onInjectCosmeticFilters(...args)
  )
  ipcMain.handle(
    mutationObserver,
    (...args: Parameters<ElectronBlocker['onIsMutationObserverEnabled']>) =>
      engine.onIsMutationObserverEnabled(...args)
  )
}

// Thrown when an enable failed and so did its undo, with the enable's error as the cause. The
// session may still hold the preload or the network filters, so a render that goes on would
// record no suppression while some filters apply.
export class ConsentBlockingUndoFailed extends Error {
  constructor(
    enableError: unknown,
    readonly undoError: unknown
  ) {
    super('The consent blocker failed to enable, and undoing the enable failed too', {
      cause: enableError
    })
    this.name = 'ConsentBlockingUndoFailed'
  }
}

// Throws the enable's own error when the engine cannot be enabled and the undo leaves nothing
// registered for this session, and ConsentBlockingUndoFailed when the undo fails as well.
export function enableConsentBlocking(engine: ElectronBlocker, session: Session): void {
  if (enabledSessions.has(session)) return
  const [other] = enabledSessions.values()
  // The bridge forwards to one engine, so a render with a different one is refused.
  if (other !== undefined && other !== engine) {
    throw new Error('Another consent filter engine is enabled in a render that is still running')
  }
  if (other !== undefined) liftBridge()
  try {
    engine.enableBlockingInSession(session)
  } catch (err) {
    let undone = true
    let undoError: unknown
    try {
      if (engine.isBlockingEnabled(session)) engine.disableBlockingInSession(session)
    } catch (caught) {
      undone = false
      undoError = caught
    }
    restoreBridge()
    if (!undone) throw new ConsentBlockingUndoFailed(err, undoError)
    throw err
  }
  enabledSessions.set(session, engine)
}

// Safe to call more than once, and for a session never enabled.
export function disableConsentBlocking(session: Session): void {
  const engine = enabledSessions.get(session)
  if (engine === undefined) return
  enabledSessions.delete(session)
  try {
    engine.disableBlockingInSession(session)
  } finally {
    restoreBridge()
  }
}
