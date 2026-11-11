import type { ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import type { MhtmlPartRow, MhtmlPartsListing } from '@shared/types'
import { formatBytes } from '@renderer/components/data/dataTableModel'
import {
  byteRange,
  countText,
  COPY_LABELS,
  encodingText,
  htmlPartLabel,
  NO_STORED_MHTML,
  OFFSET_TITLE,
  PARTS_CAPTION,
  PARTS_COLUMNS,
  partsBanners,
  refusalSentence,
  showValue,
  UNANCHORED_PARTS_CAPTION,
  type ListedParts
} from '@renderer/components/data/mhtmlPartsModel'

interface MhtmlPartsTabProps {
  listing: MhtmlPartsListing | null
  // Whether the Capture's Exhibit has a Manifest Entry, so the caption never claims one it lacks.
  anchored: boolean
  onCopy: (value: string, label: string) => void
}

function Stated({ reason, children }: { reason: string; children: ReactNode }) {
  return (
    <p
      className="p-9 text-center text-xs text-text-muted"
      data-testid="mhtml-parts-refused"
      data-reason={reason}
    >
      {children}
    </p>
  )
}

function CardLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="wrap-anywhere">
      <span className="text-text-faint">{label}: </span>
      {children}
    </div>
  )
}

function ArchiveCard({ listing }: { listing: ListedParts }) {
  const { topContentType, boundary, snapshotLocation, totalParts, fileSize, readAt } = listing
  return (
    <div
      className="mb-3 rounded-lg border border-border bg-card px-3 py-2.5 font-mono text-[11px] leading-[1.8] text-text-muted"
      data-testid="mhtml-parts-archive"
    >
      <CardLine label="Content-Type">
        {topContentType === null ? '(none)' : showValue(topContentType)}
      </CardLine>
      <CardLine label="boundary">{showValue(boundary)}</CardLine>
      <CardLine label="Snapshot-Content-Location">
        {snapshotLocation === null ? '(none)' : showValue(snapshotLocation)}
      </CardLine>
      <div>
        <span className="text-text-faint">Parts: </span>
        {countText(totalParts)} · <span className="text-text-faint">File: </span>
        {countText(fileSize)} bytes, as read now
      </div>
      <div className="text-text-faint" title={readAt}>
        Read at {new Date(readAt).toLocaleString()}
      </div>
    </div>
  )
}

function CopyButton({
  label,
  testId,
  onClick,
  children
}: {
  label: string
  testId: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="rounded px-1.5 py-0.5 text-[10px] text-accent hover:bg-accent-subtle"
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </button>
  )
}

function locationCell({ contentLocation, contentId }: MhtmlPartRow): ReactNode {
  if (contentLocation !== null) return showValue(contentLocation)
  if (contentId !== null) {
    return <span className="text-text-faint">Content-ID: {showValue(contentId)}</span>
  }
  return <span className="text-text-faint">(none)</span>
}

function typeCell({ contentType, headersTerminated }: MhtmlPartRow): ReactNode {
  if (!headersTerminated) return <span className="text-text-faint">(headers unterminated)</span>
  return contentType === null ? (
    <span className="text-text-faint">(none)</span>
  ) : (
    showValue(contentType)
  )
}

function PartRow({
  part,
  onCopy
}: {
  part: MhtmlPartRow
  onCopy: (value: string, label: string) => void
}) {
  const { position, mainDocument, contentLocation, fieldsTruncated, offset, size, sha256 } = part
  const html = htmlPartLabel(part)
  return (
    <tr
      className="border-b border-border bg-card align-top last:border-b-0 hover:bg-elevated"
      data-testid={`mhtml-part-${position}`}
    >
      <td className="px-2.5 py-1.5 text-text-faint">{position}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5" data-testid="mhtml-part-html">
        {html}
        {mainDocument && (
          <span className="ml-1.5 rounded bg-elevated px-1.5 py-px text-[10px] text-text-muted">
            main
          </span>
        )}
      </td>
      <td
        className="max-w-[320px] wrap-anywhere px-2.5 py-1.5 text-text-secondary"
        data-testid="mhtml-part-location"
      >
        {locationCell(part)}
      </td>
      <td className="wrap-anywhere px-2.5 py-1.5">{typeCell(part)}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5">{encodingText(part)}</td>
      <td className="px-2.5 py-1.5 text-right">{offset}</td>
      <td className="whitespace-nowrap px-2.5 py-1.5 text-right" title={`${countText(size)} bytes`}>
        {formatBytes(size)}
      </td>
      <td className="break-all px-2.5 py-1.5 text-text-faint" data-testid="mhtml-part-sha256">
        {sha256}
      </td>
      <td className="whitespace-nowrap px-1.5 py-1">
        <CopyButton
          label={`Copy the SHA-256 of part ${position}`}
          testId="mhtml-part-copy-sha256"
          onClick={() => onCopy(sha256, COPY_LABELS.sha256)}
        >
          SHA-256
        </CopyButton>
        {contentLocation !== null && !fieldsTruncated && (
          <CopyButton
            label={`Copy the Content-Location of part ${position}`}
            testId="mhtml-part-copy-location"
            onClick={() => onCopy(contentLocation, COPY_LABELS.contentLocation)}
          >
            Location
          </CopyButton>
        )}
        <CopyButton
          label={`Copy the byte range of part ${position}`}
          testId="mhtml-part-copy-range"
          onClick={() => onCopy(byteRange(part), COPY_LABELS.byteRange)}
        >
          Range
        </CopyButton>
      </td>
    </tr>
  )
}

function Listed({
  listing,
  anchored,
  onCopy
}: {
  listing: ListedParts
  anchored: boolean
  onCopy: (value: string, label: string) => void
}) {
  return (
    <div className="px-4 pb-6 pt-3.5" data-testid="mhtml-parts-listed">
      <ArchiveCard listing={listing} />
      {partsBanners(listing).map(({ id, text }) => (
        <p
          key={id}
          className="mb-2 flex items-start gap-1.5 rounded border border-warning-line bg-warning-surface px-2.5 py-1.5 text-[11px] text-warning-fg"
          data-testid={`mhtml-parts-banner-${id}`}
        >
          <AlertTriangle aria-hidden className="mt-px h-3 w-3 shrink-0" />
          {text}
        </p>
      ))}
      <div className="overflow-hidden rounded-lg border border-border">
        <table
          className="w-full font-mono text-[11px] text-text-muted"
          data-testid="mhtml-parts-table"
        >
          <thead>
            <tr className="border-b border-border text-left font-display text-[10px] font-semibold text-text-faint">
              <th className="px-2.5 py-1.5 font-semibold">{PARTS_COLUMNS.position}</th>
              <th className="px-2.5 py-1.5 font-semibold">{PARTS_COLUMNS.htmlPart}</th>
              <th className="px-2.5 py-1.5 font-semibold">{PARTS_COLUMNS.contentLocation}</th>
              <th className="px-2.5 py-1.5 font-semibold">{PARTS_COLUMNS.contentType}</th>
              <th className="px-2.5 py-1.5 font-semibold">{PARTS_COLUMNS.encoding}</th>
              <th className="px-2.5 py-1.5 text-right font-semibold" title={OFFSET_TITLE}>
                {PARTS_COLUMNS.offset}
              </th>
              <th className="px-2.5 py-1.5 text-right font-semibold">{PARTS_COLUMNS.size}</th>
              <th className="px-2.5 py-1.5 font-semibold">{PARTS_COLUMNS.sha256}</th>
              <th className="px-1.5 py-1.5 font-semibold">{PARTS_COLUMNS.copy}</th>
            </tr>
          </thead>
          <tbody>
            {listing.parts.map((part) => (
              <PartRow key={part.position} part={part} onCopy={onCopy} />
            ))}
          </tbody>
        </table>
      </div>
      <p
        className="mx-0.5 mt-2.5 text-[11px] leading-relaxed text-text-faint"
        data-testid="mhtml-parts-caption"
      >
        {anchored ? PARTS_CAPTION : UNANCHORED_PARTS_CAPTION}
      </p>
    </div>
  )
}

/**
 * The parts inside a Capture's stored MHTML (#991), as main read them for this showing. Display
 * only: a part can be copied by hash, location or byte range, never opened or saved, because
 * its bytes have no Manifest Entry of their own (ADR-0023). The Content-Location is text and
 * never a link, so nothing here navigates to a captured address.
 */
export function MhtmlPartsTab({ listing, anchored, onCopy }: MhtmlPartsTabProps) {
  if (listing === null) return <Stated reason="none">{NO_STORED_MHTML}</Stated>
  if (listing.status === 'refused') {
    const { refusal } = listing
    return <Stated reason={refusal.reason}>{refusalSentence(refusal)}</Stated>
  }
  return <Listed listing={listing} anchored={anchored} onCopy={onCopy} />
}
