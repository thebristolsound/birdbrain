import { readFile } from 'fs/promises'
import * as cheerio from 'cheerio'
import type { Capture, CaptureLink, CaptureLinks } from '@shared/types'
import {
  CAPTURE_LINK_BUDGETS,
  documentBase,
  readHtmlParts,
  resolveUrl,
  type CaptureLinkBudgets,
  type HtmlPartInput
} from '@main/services/htmlParts'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'

// The links in a stored page, for the Links tab (#1708). Computed from the MHTML on
// demand and never stored: it is display data derived from an Exhibit, not part of
// one. The guest renders with scripts off, so the renderer cannot read the links
// from the page and this module parses the archive instead.

function withoutFragment(url: string): string {
  const hash = url.indexOf('#')
  return hash === -1 ? url : url.slice(0, hash)
}

function linkKind(href: string, resolved: boolean, documentUrl: string): CaptureLink['kind'] {
  if (resolved && withoutFragment(href) === withoutFragment(documentUrl)) return 'same-page'
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase()
  if (resolved && (scheme === 'http' || scheme === 'https')) return 'http'
  if (scheme === 'mailto') return 'mailto'
  if (scheme === 'tel') return 'tel'
  return 'other'
}

/** Lower-cases, converts to ASCII through `URL`, and strips one leading `www.`. */
function normalisedHost(url: URL): string {
  return url.hostname.replace(/\.$/, '').replace(/^www\./, '')
}

const BARE_HOST = /^(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?:[/:?#]\S*)?$/u

// The host the visible text names, when it reads as a URL or a bare host name.
function textHost(text: string): string | null {
  if (!text || /\s/.test(text)) return null
  try {
    if (/^https?:\/\//i.test(text)) return normalisedHost(new URL(text))
    if (BARE_HOST.test(text)) return normalisedHost(new URL(`http://${text}`))
  } catch {
    return null
  }
  return null
}

// Any web destination, same-page included: `<a href="#login">bank.example</a>` on
// another host misleads as much as an outbound link does.
function hostMismatch(href: string, text: string): boolean {
  const named = textHost(text)
  if (named === null) return false
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return named !== normalisedHost(url)
}

function collectLinks(
  parts: HtmlPartInput[],
  maxRows: number
): { links: CaptureLink[]; truncated: boolean } {
  const rows = new Map<string, CaptureLink>()
  let truncated = false
  for (const { html, documentUrl, frame } of parts) {
    if (truncated) break
    const $ = cheerio.load(html)
    const base = documentBase($, documentUrl)
    $('a[href], area[href]').each((_, element) => {
      const node = $(element)
      const rawHref = node.attr('href') ?? ''
      const resolvedHref = resolveUrl(rawHref.trim(), base)
      const href = resolvedHref ?? rawHref
      const ownText = node.text().replace(/\s+/g, ' ').trim()
      const text =
        ownText ||
        (node.is('area')
          ? (node.attr('alt') ?? '')
          : (node.find('img[alt]').first().attr('alt') ?? '')
        )
          .replace(/\s+/g, ' ')
          .trim()
      const rel = (node.attr('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      // documentUrl is in the key because `kind` is judged against it: the same href and
      // text can be same-page in one embedded frame and external in another.
      const key = JSON.stringify([href, text, frame, documentUrl])
      const existing = rows.get(key)
      if (existing) {
        existing.occurrences += 1
        for (const token of rel) if (!existing.rel.includes(token)) existing.rel.push(token)
        return
      }
      if (rows.size >= maxRows) {
        // Stops this part and every later one: nothing past here can add a row, and
        // resolving the rest would hold the main process for no listed result.
        truncated = true
        return false
      }
      const kind = linkKind(href, resolvedHref !== null, documentUrl)
      rows.set(key, {
        href,
        rawHref,
        text,
        rel: [...new Set(rel)],
        kind,
        frame,
        documentUrl,
        occurrences: 1,
        textHostMismatch: hostMismatch(href, text)
      })
    })
  }
  return { links: [...rows.values()], truncated }
}

/** The links in an MHTML, read under the shared part ceilings (htmlParts.ts). */
export function linksFromMhtml(
  buffer: Buffer,
  captureUrl: string,
  budgets: CaptureLinkBudgets = CAPTURE_LINK_BUDGETS
): CaptureLinks {
  const { parts, skippedParts, mainDocumentSkipped } = readHtmlParts(buffer, captureUrl, budgets)
  const { links, truncated } = collectLinks(parts, budgets.maxRows)
  return { links, truncated, skippedParts, mainDocumentSkipped }
}

/**
 * The links in a Capture's stored page, or null when it has no MHTML to read: a
 * pre-v11 HTML Capture, or one whose file is gone. Reads the same file the Page tab
 * shows (`captures:getMhtmlUrl`).
 */
export async function readCaptureLinks(
  capture: Capture | null | undefined,
  store: Pick<CaptureStore, 'resolveAbsolute'> = defaultCaptureStore
): Promise<CaptureLinks | null> {
  if (!capture || !capture.mhtmlPath) return null
  let buffer: Buffer
  try {
    buffer = await readFile(store.resolveAbsolute(capture.mhtmlPath))
  } catch (err) {
    // A file that is not there is the no-archive answer; any other failure is not.
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
  return linksFromMhtml(buffer, capture.url)
}
