import type { CaptureLink } from '@shared/types'

// The Links tab's pure parts (#1708): filtering and the host emphasis.

function hostOf(url: string): string | null {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol !== 'http:' && protocol !== 'https:') return null
    return hostname.replace(/\.$/, '').replace(/^www\./, '')
  } catch {
    return null
  }
}

export interface LinkFilter {
  query: string
  /** Keep only web links to a host other than the Capture's own. */
  externalOnly: boolean
}

export function filterLinks(
  links: readonly CaptureLink[],
  { query, externalOnly }: LinkFilter,
  captureUrl: string
): CaptureLink[] {
  const needle = query.trim().toLowerCase()
  const ownHost = hostOf(captureUrl)
  return links.filter((link) => {
    if (externalOnly) {
      if (link.kind !== 'http') return false
      if (hostOf(link.href) === ownHost) return false
    }
    if (!needle) return true
    return link.text.toLowerCase().includes(needle) || link.href.toLowerCase().includes(needle)
  })
}

/** A destination cut around its host, so the host can be shown apart from the rest. */
export function splitAtHost(href: string): { before: string; host: string; after: string } {
  const match = /^([a-z][a-z0-9+.-]*:\/\/(?:[^/?#@]*@)?)([^/?#:]+)(.*)$/i.exec(href)
  if (!match) return { before: href, host: '', after: '' }
  const [, before, host, after] = match
  return { before, host, after }
}
