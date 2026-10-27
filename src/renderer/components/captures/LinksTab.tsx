import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Search } from 'lucide-react'
import type { Capture, CaptureLink, FieldHit } from '@shared/types'
import { fieldLabel } from '@shared/searchFields'
import { canonicalizeUrl } from '@shared/urlCanonicalize'
import { captureLinksQueryOptions, capturesQueryOptions } from '@renderer/lib/api/captures'
import { useAppStore } from '@renderer/stores/appStore'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import { useLinkMenuTarget, type LinkHit } from '@renderer/components/captures/useLinkMenuTarget'
import { filterLinks, isWebHref, splitAtHost } from '@renderer/components/captures/linksTabModel'
import { linkClickOutcome } from '@renderer/components/captures/guestLink'
import { WaybackLinkCell } from '@renderer/components/captures/WaybackLinkCell'

const KIND_LABELS: Record<CaptureLink['kind'], string> = {
  http: 'web',
  'same-page': 'same page',
  mailto: 'email',
  tel: 'phone',
  other: 'other'
}

const NO_HIT: LinkHit = { linkUrl: '', linkText: '', imageUrl: '', selectionText: '' }

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      data-testid="links-empty"
      className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center"
    >
      <p className="text-sm text-text-muted">{title}</p>
      <p className="max-w-[420px] text-xs text-text-faint">{detail}</p>
    </div>
  )
}

// A search hit's place in the stored page: the text/html part and the span in it, in
// UTF-16 code units of the decoded part (docs/plans/2026-10-09-case-retrieval-first-
// slice.md, D3 and D7).
function hitPlace({ locator }: FieldHit): string {
  return `part ${locator.part}, characters ${locator.startOffset} to ${locator.endOffset}`
}

// The Links tab collapses repeats and keeps no offsets, so a hit finds its row by value:
// a link target by its resolved address, and alt text by the row's text, which is an
// image's alt when the link has no text of its own. Any other field read from the page,
// such as an image address or a tracking code, is not a link and marks no row.
function matchesHit(link: CaptureLink, hit: FieldHit): boolean {
  if (hit.field === 'link.href') return link.href === hit.norm
  return hit.field === 'link.alt' && link.text === hit.norm
}

function LinkRow({
  link,
  inCase,
  index,
  hit,
  onOpen,
  wayback
}: {
  link: CaptureLink
  inCase: boolean
  index: number
  hit?: FieldHit
  onOpen: () => void
  wayback?: ReactNode
}) {
  const { before, host, after } = splitAtHost(link.href)
  return (
    <li
      data-testid="links-row"
      data-link-index={index}
      data-link-hit={hit ? '' : undefined}
      className={`flex flex-col gap-1 border-b border-border px-4 py-2 ${
        hit ? 'bg-warning-surface' : 'hover:bg-elevated'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        {/* The text, not the row, is the control, so another cell can hold one of its own. */}
        <button
          type="button"
          data-testid="links-open"
          onClick={onOpen}
          className="min-w-0 flex-1 truncate rounded-sm text-left text-xs font-medium text-text-primary focus-visible:outline-2 focus-visible:outline-ring"
        >
          {link.text || <span className="text-text-faint">(no text)</span>}
        </button>
        {link.textHostMismatch && (
          <span
            data-testid="links-mismatch"
            title="The link text names a different host from the one the link goes to"
            className="flex shrink-0 items-center gap-1 rounded border border-warning-line bg-warning-surface px-1.5 text-[10px] text-warning-fg"
          >
            <AlertTriangle aria-hidden className="h-2.5 w-2.5" />
            Text names another host
          </span>
        )}
        {inCase && (
          <span
            data-testid="links-in-case"
            className="shrink-0 rounded bg-accent-subtle px-1.5 text-[10px] font-semibold text-accent"
          >
            In Case
          </span>
        )}
      </div>
      <div className="truncate text-[11px] text-text-muted" title={link.href}>
        {before}
        <span className="font-semibold text-text-secondary">{host}</span>
        {after}
      </div>
      <div className="flex flex-wrap items-center gap-1 text-[10px] text-text-faint">
        <span className="rounded border border-border px-1">{KIND_LABELS[link.kind]}</span>
        {link.frame === 'subframe' && (
          <span
            data-testid="links-subframe"
            title={`In an embedded frame: ${link.documentUrl}`}
            className="rounded border border-border px-1"
          >
            frame
          </span>
        )}
        {link.rel.map((token) => (
          <span key={token} className="rounded bg-surface px-1">
            rel={token}
          </span>
        ))}
        {link.occurrences > 1 && <span>×{link.occurrences}</span>}
        {wayback}
      </div>
      {hit && (
        <div data-testid="links-hit" className="text-[10px] text-warning-fg">
          Search hit, {fieldLabel(hit.field)}
        </div>
      )}
    </li>
  )
}

/**
 * The Links tab (#1708): every link in the stored page, read from its MHTML in the
 * main process. The rows offer the same menu as a right-click in the Page tab. A search
 * hit opened here marks its rows and scrolls to the first. Activating a row the Case
 * holds opens that Capture as a click in the Page tab does (#1735); any other row does
 * nothing.
 */
export function LinksTab({ capture, hit }: { capture: Capture; hit?: FieldHit }) {
  const isMhtml = capture.format === 'mhtml'
  const { data, error, isPending } = useQuery({
    ...captureLinksQueryOptions(capture.id),
    enabled: isMhtml
  })
  const { data: captures = [] } = useQuery(capturesQueryOptions(capture.caseId))
  const linkTarget = useLinkMenuTarget(capture.caseId, capture.id)
  const followCaptureLink = useAppStore((s) => s.followCaptureLink)
  const [query, setQuery] = useState('')
  const [externalOnly, setExternalOnly] = useState(false)
  const [menuHit, setMenuHit] = useState<LinkHit>(NO_HIT)
  const listRef = useRef<HTMLUListElement | null>(null)
  // One canonical-URL pass per link list and Case, not one scan of the Case per row on
  // every render. Same-page web links count too: the viewed Capture holds them.
  const inCaseHrefs = useMemo(() => {
    const captured = new Set(captures.map(({ url }) => canonicalizeUrl(url)))
    const hrefs = new Set<string>()
    for (const { href } of data?.links ?? []) {
      if (isWebHref(href) && captured.has(canonicalizeUrl(href))) hrefs.add(href)
    }
    return hrefs
  }, [data, captures])

  useEffect(() => {
    // jsdom has no layout, so it has no scrollIntoView either.
    listRef.current?.querySelector('[data-link-hit]')?.scrollIntoView?.({ block: 'center' })
  }, [data, hit])

  if (!isMhtml) {
    return (
      <EmptyState
        title="No link list for this capture"
        detail={`It was stored as plain HTML, before captures were kept as MHTML archives. Links are listed from an MHTML archive only.${
          hit
            ? ` The search hit is at characters ${hit.locator.startOffset} to ${hit.locator.endOffset} of the stored page.`
            : ''
        }`}
      />
    )
  }
  if (error) {
    return <EmptyState title="Couldn't read the stored page" detail={String(error)} />
  }
  if (isPending) {
    return (
      <p data-testid="links-loading" className="p-4 text-sm text-text-muted">
        Reading links…
      </p>
    )
  }
  if (data === null) {
    return (
      <EmptyState
        title="No stored page to read"
        detail="This capture's MHTML archive is not on disk, so its links cannot be listed."
      />
    )
  }
  const notices: string[] = []
  if (data.mainDocumentSkipped) {
    notices.push('The main document is too large to read; only links in its frames are listed.')
  }
  const { tooLarge, overPartCount, overTotalSize } = data.skippedParts
  const frames = (n: number) => (n === 1 ? '1 embedded frame' : `${n} embedded frames`)
  if (tooLarge > 0) notices.push(`Not listed: ${frames(tooLarge)}, each too large to read.`)
  if (overPartCount > 0) {
    notices.push(`Not listed: ${frames(overPartCount)} past the number of frames this tab reads.`)
  }
  if (overTotalSize > 0) {
    notices.push(`Not listed: ${frames(overTotalSize)} past the total size this tab reads.`)
  }
  if (hit && data.links.length > 0) {
    // The offsets are the first record's, so they are stated once rather than on rows
    // that may sit elsewhere in the page.
    notices.push(
      data.links.some((link) => matchesHit(link, hit))
        ? `Search hit, ${fieldLabel(hit.field)}, first found at ${hitPlace(hit)}. Every row with the same ${hit.field === 'link.href' ? 'address' : 'text'} is marked.`
        : `No listed link matches the search hit at ${hitPlace(hit)}.`
    )
  }
  if (data.truncated) {
    notices.push(
      `Only the first ${data.links.length} links are listed. Reading stopped there, so repeat counts cover the page up to that point.`
    )
  }
  const noticeList = notices.map((notice) => (
    <p
      key={notice}
      data-testid="links-notice"
      className="shrink-0 border-b border-border px-4 py-1.5 text-[11px] text-text-muted"
    >
      {notice}
    </p>
  ))

  if (data.links.length === 0) {
    if (data.mainDocumentSkipped) {
      return (
        <EmptyState
          title="The page is too large to list its links"
          detail="Its main document is over the size this tab reads. The Page tab still shows it."
        />
      )
    }
    if (notices.length === 0) {
      return <EmptyState title="No links on this page" detail="The stored page holds no links." />
    }
    // Frames were skipped, so "no links" would claim more than was read.
    return (
      <div data-testid="links-tab" className="flex h-full flex-col overflow-hidden">
        {noticeList}
        <div className="min-h-0 flex-1">
          <EmptyState
            title="No links in what was read"
            detail="Some embedded frames were not read, so this page may hold links that are not listed."
          />
        </div>
      </div>
    )
  }

  const shown = filterLinks(data.links, { query, externalOnly }, capture.url)

  return (
    <div data-testid="links-tab" className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-3 py-2">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded border border-border bg-canvas px-2">
          <Search aria-hidden className="h-3 w-3 text-text-faint" />
          <input
            type="search"
            aria-label="Search links"
            placeholder="Search text or address"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-6 min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none"
          />
        </label>
        <label className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-secondary">
          <input
            type="checkbox"
            checked={externalOnly}
            onChange={(e) => setExternalOnly(e.target.checked)}
          />
          External only
        </label>
        <span data-testid="links-count" className="shrink-0 text-[11px] text-text-faint">
          {shown.length} of {data.links.length}
        </span>
      </div>
      {noticeList}
      {shown.length === 0 ? (
        <EmptyState title="No links match" detail="Change the search or turn off External only." />
      ) : (
        <EntityContextMenu target={linkTarget(menuHit)} className="min-h-0 flex-1 overflow-y-auto">
          <ul
            ref={listRef}
            onContextMenu={(e) => {
              // One menu serves every row: the row under the pointer becomes its target
              // in the same update that opens it. Off a row there is nothing to act on.
              const row = (e.target as HTMLElement).closest('[data-link-index]')
              const link = row ? shown[Number(row.getAttribute('data-link-index'))] : undefined
              if (!link) {
                e.preventDefault()
                return
              }
              setMenuHit({
                linkUrl: link.href,
                linkText: link.text,
                imageUrl: '',
                selectionText: ''
              })
            }}
          >
            {shown.map((link, index) => (
              <LinkRow
                key={`${link.frame} ${link.documentUrl} ${link.href} ${link.text}`}
                link={link}
                index={index}
                inCase={inCaseHrefs.has(link.href)}
                hit={hit && matchesHit(link, hit) ? hit : undefined}
                onOpen={() => {
                  const outcome = linkClickOutcome(link.href, capture, captures)
                  if (outcome.kind === 'open') followCaptureLink(outcome.captureId)
                }}
                wayback={
                  isWebHref(link.href) ? (
                    <WaybackLinkCell capture={capture} url={link.href} />
                  ) : undefined
                }
              />
            ))}
          </ul>
        </EntityContextMenu>
      )}
    </div>
  )
}
