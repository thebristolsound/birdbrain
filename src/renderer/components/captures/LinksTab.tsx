import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Search } from 'lucide-react'
import type { Capture, CaptureLink } from '@shared/types'
import { resolveCaptureForUrl } from '@shared/urlCanonicalize'
import { captureLinksQueryOptions, capturesQueryOptions } from '@renderer/lib/api/captures'
import { EntityContextMenu } from '@renderer/components/contextmenu/EntityContextMenu'
import { useLinkMenuTarget, type LinkHit } from '@renderer/components/captures/useLinkMenuTarget'
import { filterLinks, splitAtHost } from '@renderer/components/captures/linksTabModel'

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

function LinkRow({ link, inCase, index }: { link: CaptureLink; inCase: boolean; index: number }) {
  const { before, host, after } = splitAtHost(link.href)
  return (
    <li
      data-testid="links-row"
      data-link-index={index}
      className="flex flex-col gap-1 border-b border-border px-4 py-2 hover:bg-elevated"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-primary">
          {link.text || <span className="text-text-faint">(no text)</span>}
        </span>
        {link.textHostMismatch && (
          <span
            data-testid="links-mismatch"
            title="The link text names a different host from the one the link goes to"
            className="flex shrink-0 items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 text-[10px] text-amber-500"
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
      </div>
    </li>
  )
}

/**
 * The Links tab (#1708): every link in the stored page, read from its MHTML in the
 * main process. The rows offer the same menu as a right-click in the Page tab.
 */
export function LinksTab({ capture }: { capture: Capture }) {
  const isMhtml = capture.format === 'mhtml'
  const { data, error, isPending } = useQuery({
    ...captureLinksQueryOptions(capture.id),
    enabled: isMhtml
  })
  const { data: captures = [] } = useQuery(capturesQueryOptions(capture.caseId))
  const linkTarget = useLinkMenuTarget(capture.caseId)
  const [query, setQuery] = useState('')
  const [externalOnly, setExternalOnly] = useState(false)
  const [hit, setHit] = useState<LinkHit>(NO_HIT)

  if (!isMhtml) {
    return (
      <EmptyState
        title="No link list for this capture"
        detail="It was stored as plain HTML, before captures were kept as MHTML archives. Links are listed from an MHTML archive only."
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
  if (data.mainDocumentSkipped && data.links.length === 0) {
    return (
      <EmptyState
        title="The page is too large to list its links"
        detail="Its main document is over the size this tab reads. The Page tab still shows it."
      />
    )
  }
  if (data.links.length === 0) {
    return <EmptyState title="No links on this page" detail="The stored page holds no links." />
  }

  const shown = filterLinks(data.links, { query, externalOnly }, capture.url)
  const notices: string[] = []
  if (data.mainDocumentSkipped) {
    notices.push('The main document is too large to read; only links in its frames are listed.')
  }
  const { tooLarge, overPartCount, overTotalSize } = data.skippedParts
  if (tooLarge + overPartCount + overTotalSize > (data.mainDocumentSkipped ? 1 : 0)) {
    notices.push('Some embedded frames are too large to read and are not listed.')
  }
  if (data.truncated) notices.push(`Only the first ${data.links.length} links are listed.`)

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
      {notices.map((notice) => (
        <p
          key={notice}
          data-testid="links-notice"
          className="shrink-0 border-b border-border px-4 py-1.5 text-[11px] text-text-muted"
        >
          {notice}
        </p>
      ))}
      {shown.length === 0 ? (
        <EmptyState title="No links match" detail="Change the search or turn off External only." />
      ) : (
        <EntityContextMenu target={linkTarget(hit)} className="min-h-0 flex-1 overflow-y-auto">
          <ul
            onContextMenu={(e) => {
              // One menu serves every row: the row under the pointer becomes its target
              // in the same update that opens it. Off a row there is nothing to act on.
              const row = (e.target as HTMLElement).closest('[data-link-index]')
              const link = row ? shown[Number(row.getAttribute('data-link-index'))] : undefined
              if (!link) {
                e.preventDefault()
                return
              }
              setHit({ linkUrl: link.href, linkText: link.text, imageUrl: '', selectionText: '' })
            }}
          >
            {shown.map((link, index) => (
              <LinkRow
                key={`${link.frame} ${link.href} ${link.text}`}
                link={link}
                index={index}
                inCase={link.kind === 'http' && resolveCaptureForUrl(link.href, captures) !== null}
              />
            ))}
          </ul>
        </EntityContextMenu>
      )}
    </div>
  )
}
