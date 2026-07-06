import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { ElectronBlocker } from '@ghostery/adblocker-electron'

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
  blockerPromise = ElectronBlocker.fromLists(fetch, lists, undefined, caching).catch(
    (err): null => {
      console.error('consentBlocker: failed to build consent filter engine', err)
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
