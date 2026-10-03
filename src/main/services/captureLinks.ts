import { existsSync, readFileSync } from 'fs'
import * as cheerio from 'cheerio'
import type { Capture, CaptureLink, CaptureLinks } from '@shared/types'
import { listHtmlPartsInMhtml } from '@main/services/mhtmlDecoder'
import { defaultCaptureStore, type CaptureStore } from '@main/services/captureStore'

// The links in a stored page, for the Links tab (#1708). Computed from the MHTML on
// demand and never stored: it is display data derived from an Exhibit, not part of
// one. The guest renders with scripts off, so the renderer cannot read the links
// from the page and this module parses the archive instead.

export interface CaptureLinkBudgets {
  /** An HTML part larger than this, as stored, is skipped without being decoded. */
  maxPartBytes: number
  /** HTML parts after this many are skipped. */
  maxParts: number
  /** Rows after this many are not listed. */
  maxRows: number
}

// This module's own ceilings, applied before a part is decoded. MAX_HTML_BYTES is a
// different rule (the sanitizer truncates a document and still parses it), so it is
// not reused.
export const CAPTURE_LINK_BUDGETS: CaptureLinkBudgets = {
  maxPartBytes: 8 * 1024 * 1024,
  maxParts: 64,
  maxRows: 5000
}

function resolve(value: string, base: string): string | null {
  try {
    return new URL(value, base).href
  } catch {
    return null
  }
}

// A part's document URL: its Content-Location against the Capture's URL. A `cid:`
// location names a part, not a page, so it falls back to the Capture's URL, as does
// one that does not parse.
function partDocumentUrl(contentLocation: string | null, captureUrl: string): string {
  if (!contentLocation || /^cid:/i.test(contentLocation)) return captureUrl
  return resolve(contentLocation, captureUrl) ?? captureUrl
}

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

function hostMismatch(kind: CaptureLink['kind'], href: string, text: string): boolean {
  if (kind !== 'http') return false
  const named = textHost(text)
  if (named === null) return false
  return named !== normalisedHost(new URL(href))
}

interface PartInput {
  html: string
  documentUrl: string
  frame: CaptureLink['frame']
}

function collectLinks(
  parts: PartInput[],
  maxRows: number
): { links: CaptureLink[]; truncated: boolean } {
  const rows = new Map<string, CaptureLink>()
  let truncated = false
  for (const { html, documentUrl, frame } of parts) {
    const $ = cheerio.load(html)
    const baseHref = $('base[href]').first().attr('href')
    const base = (baseHref && resolve(baseHref, documentUrl)) || documentUrl
    $('a[href], area[href]').each((_, element) => {
      const node = $(element)
      const rawHref = node.attr('href') ?? ''
      const resolvedHref = resolve(rawHref.trim(), base)
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
      const key = JSON.stringify([href, text, frame])
      const existing = rows.get(key)
      if (existing) {
        existing.occurrences += 1
        for (const token of rel) if (!existing.rel.includes(token)) existing.rel.push(token)
        return
      }
      if (rows.size >= maxRows) {
        truncated = true
        return
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
        textHostMismatch: hostMismatch(kind, href, text)
      })
    })
  }
  return { links: [...rows.values()], truncated }
}

/**
 * The links in an MHTML. The main document is the part whose Content-Location is the
 * archive's `Snapshot-Content-Location`, else the first HTML part; every other HTML
 * part is a subframe. Ceilings are checked before a part is decoded, and anything
 * they refuse is counted rather than dropped in silence.
 */
export function linksFromMhtml(
  buffer: Buffer,
  captureUrl: string,
  budgets: CaptureLinkBudgets = CAPTURE_LINK_BUDGETS
): CaptureLinks {
  const { snapshotLocation, parts } = listHtmlPartsInMhtml(buffer)
  const snapshotIndex =
    snapshotLocation === null
      ? -1
      : parts.findIndex((part) => part.contentLocation === snapshotLocation)
  const mainIndex = snapshotIndex === -1 ? 0 : snapshotIndex
  const ordered =
    parts.length === 0 ? [] : [parts[mainIndex], ...parts.filter((_, i) => i !== mainIndex)]

  const inputs: PartInput[] = []
  let skippedParts = 0
  let mainDocumentSkipped = false
  ordered.forEach((part, index) => {
    if (index >= budgets.maxParts || part.encodedSize > budgets.maxPartBytes) {
      skippedParts += 1
      if (index === 0) mainDocumentSkipped = true
      return
    }
    inputs.push({
      html: part.decode(),
      documentUrl: partDocumentUrl(part.contentLocation, captureUrl),
      frame: index === 0 ? 'main' : 'subframe'
    })
  })
  const { links, truncated } = collectLinks(inputs, budgets.maxRows)
  return { links, truncated, skippedParts, mainDocumentSkipped }
}

/**
 * The links in a Capture's stored page, or null when it has no MHTML to read: a
 * pre-v11 HTML Capture, or one whose file is gone. Reads the same file the Page tab
 * shows (`captures:getMhtmlUrl`).
 */
export function readCaptureLinks(
  capture: Capture | null | undefined,
  store: Pick<CaptureStore, 'resolveAbsolute'> = defaultCaptureStore
): CaptureLinks | null {
  if (!capture || !capture.mhtmlPath) return null
  const abs = store.resolveAbsolute(capture.mhtmlPath)
  if (!existsSync(abs)) return null
  return linksFromMhtml(readFileSync(abs), capture.url)
}
