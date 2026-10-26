import { captureLinkBlockReason } from '@shared/localAddress'

/**
 * The most addresses one Wayback batch sends (#1738, plan S4), after refusals and
 * de-duplication. Sized against the pause in `src/main/services/waybackLinkCheck.ts`:
 * measured 2026-10-26, six CDX lookups 2 s apart answered in 0.32 s to 1.79 s each, so
 * 50 addresses take about 2 to 3 minutes when archive.org answers at that speed.
 */
export const WAYBACK_LINK_BATCH_CAP = 50

export interface RefusedLink {
  url: string
  reason: string
  /** How many of the rows asked about hold this address. */
  rows: number
}

export interface LinkBatchPlan {
  /** The addresses sent, each once, in the order the rows first show them. */
  send: string[]
  /** Allowed addresses past the cap, each once. None of them is sent. */
  overCap: string[]
  /** Addresses the shared address rule refuses, each once, with its reason. */
  refused: RefusedLink[]
}

/**
 * What a batch over the rows `urls` sends: the confirmation lists `send`, and passes that
 * list, not the rows, to main.
 */
export function planLinkBatch(urls: readonly string[]): LinkBatchPlan {
  const allowed: string[] = []
  const refused = new Map<string, RefusedLink>()
  const seen = new Set<string>()
  for (const url of urls) {
    const known = refused.get(url)
    if (known) {
      known.rows += 1
      continue
    }
    if (seen.has(url)) continue
    const reason = captureLinkBlockReason(url)
    if (reason) {
      refused.set(url, { url, reason, rows: 1 })
      continue
    }
    seen.add(url)
    allowed.push(url)
  }
  return {
    send: allowed.slice(0, WAYBACK_LINK_BATCH_CAP),
    overCap: allowed.slice(WAYBACK_LINK_BATCH_CAP),
    refused: [...refused.values()]
  }
}

/**
 * Why main refuses a confirmed `send` list, or null. Main does not plan the rows again:
 * the window's URL parser and main's read some malformed addresses differently (Chromium
 * reads `http://ex ample.com/` as a web address, Node refuses it), and a second plan
 * would shift the cap onto addresses the confirmation said were not checked. Main instead
 * sends a list it accepts whole, so it only ever sends addresses the Operator was shown.
 * The caller has already refused a list longer than `WAYBACK_LINK_BATCH_CAP`.
 */
export function confirmedBatchRefusal(urls: readonly string[]): string | null {
  if (new Set(urls).size !== urls.length) return 'The batch lists an address twice'
  for (const url of urls) {
    const reason = captureLinkBlockReason(url)
    if (reason) return `${reason}: ${url}`
  }
  return null
}
